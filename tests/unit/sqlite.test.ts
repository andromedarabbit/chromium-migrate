import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {
  openReadonlyCopy,
  openWritable,
  insertBatch,
  countRows,
  tableExists,
  copyDatabaseFile,
  iterateBatched,
} from '../../src/database/sqlite.js';

describe('sqlite', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arc2brave-db-'));
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it('copies and counts rows', async () => {
    const src = path.join(tmp, 'src.db');
    const db = new Database(src);
    db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT);');
    db.prepare('INSERT INTO urls (url) VALUES (?)').run('https://example.com');
    db.prepare('INSERT INTO urls (url) VALUES (?)').run('https://brave.com');
    db.close();

    const dest = path.join(tmp, 'dest.db');
    await copyDatabaseFile(src, dest);
    const handle = await openReadonlyCopy(dest);
    try {
      expect(tableExists(handle.db, 'urls')).toBe(true);
      expect(countRows(handle.db, 'urls')).toBe(2);
    } finally {
      await handle.close();
    }
  });

  it('inserts batches and iterates', async () => {
    const dbPath = path.join(tmp, 'batch.db');
    const db = await openWritable(dbPath);
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);');
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `n${i}` }));
    insertBatch(db, 'items', rows, { replace: true });
    expect(countRows(db, 'items')).toBe(25);

    let total = 0;
    for (const batch of iterateBatched<{ id: number; name: string }>(db, 'items', 10)) {
      total += batch.length;
    }
    expect(total).toBe(25);
    db.close();
  });
});
