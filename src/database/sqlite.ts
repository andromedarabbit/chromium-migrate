import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'node:path';
import { SQLITE_BUSY_TIMEOUT_MS } from '../core/constants.js';
import { getLogger, logSql } from '../utils/logger.js';

export type SqliteDatabase = Database.Database;

/**
 * Open a Chromium SQLite DB safely.
 * Chromium often locks DBs; we copy to a temp file for reads,
 * and for writes we open the target with a busy timeout.
 */
export async function openReadonlyCopy(dbPath: string): Promise<{
  db: SqliteDatabase;
  tempPath: string;
  close: () => Promise<void>;
}> {
  if (!(await fs.pathExists(dbPath))) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  const tempPath = path.join(
    path.dirname(dbPath),
    `.cmigrate-ro-${path.basename(dbPath)}-${process.pid}-${Date.now()}`,
  );
  // Copy main DB + WAL/SHM if present for consistency
  await fs.copy(dbPath, tempPath);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const side = dbPath + suffix;
    if (await fs.pathExists(side)) {
      await fs.copy(side, tempPath + suffix).catch(() => undefined);
    }
  }

  const db = new Database(tempPath, { readonly: true, fileMustExist: true });
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  logSql('open_readonly', { dbPath, tempPath });

  return {
    db,
    tempPath,
    close: async () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      for (const p of [tempPath, tempPath + '-wal', tempPath + '-shm', tempPath + '-journal']) {
        await fs.remove(p).catch(() => undefined);
      }
    },
  };
}

export async function openWritable(dbPath: string): Promise<SqliteDatabase> {
  await fs.ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  db.pragma('journal_mode = WAL');
  logSql('open_writable', { dbPath });
  return db;
}

export function tableExists(db: SqliteDatabase, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

export function getColumns(db: SqliteDatabase, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function countRows(db: SqliteDatabase, table: string, where = ''): number {
  const sql = where ? `SELECT COUNT(*) AS c FROM ${table} WHERE ${where}` : `SELECT COUNT(*) AS c FROM ${table}`;
  const row = db.prepare(sql).get() as { c: number };
  return row.c;
}

/**
 * Iterate a table in batches using ROWID / integer primary key paging.
 */
export function* iterateBatched<T extends Record<string, unknown>>(
  db: SqliteDatabase,
  table: string,
  batchSize: number,
  columns = '*',
  orderBy = 'rowid',
): Generator<T[]> {
  let offset = 0;
  for (;;) {
    const rows = db
      .prepare(`SELECT ${columns} FROM ${table} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(batchSize, offset) as T[];
    if (rows.length === 0) break;
    yield rows;
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
}

export function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  const tx = db.transaction(fn);
  return tx();
}

/**
 * Copy an entire SQLite database file (plus WAL) to destination.
 * Prefer this when schemas are identical and a full replace is safe.
 */
export async function copyDatabaseFile(src: string, dest: string): Promise<boolean> {
  if (!(await fs.pathExists(src))) return false;
  await fs.ensureDir(path.dirname(dest));
  // Remove stale WAL on destination first
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.remove(dest + suffix).catch(() => undefined);
  }
  await fs.copy(src, dest, { overwrite: true });
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const side = src + suffix;
    if (await fs.pathExists(side)) {
      await fs.copy(side, dest + suffix, { overwrite: true }).catch(() => undefined);
    }
  }
  getLogger().info(`Copied database ${src} → ${dest}`);
  return true;
}

/**
 * Insert rows in batches with column intersection (handles schema drift).
 */
export function insertBatch(
  db: SqliteDatabase,
  table: string,
  rows: Record<string, unknown>[],
  options: { replace?: boolean; skipColumns?: string[] } = {},
): number {
  if (rows.length === 0) return 0;
  const cols = getColumns(db, table).filter((c) => !options.skipColumns?.includes(c));
  if (cols.length === 0) return 0;

  const placeholders = cols.map(() => '?').join(', ');
  const colList = cols.join(', ');
  const verb = options.replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  const stmt = db.prepare(`${verb} INTO ${table} (${colList}) VALUES (${placeholders})`);

  let inserted = 0;
  const run = db.transaction((batch: Record<string, unknown>[]) => {
    for (const row of batch) {
      const values = cols.map((c) => (c in row ? row[c] : null));
      const result = stmt.run(...values);
      inserted += result.changes;
    }
  });
  run(rows);
  logSql('insert_batch', { table, attempted: rows.length, inserted });
  return inserted;
}

export function clearTable(db: SqliteDatabase, table: string): void {
  if (!tableExists(db, table)) return;
  db.exec(`DELETE FROM ${table}`);
  logSql('clear_table', { table });
}
