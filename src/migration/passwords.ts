import fs from 'fs-extra';
import { BATCH_SIZE } from '../core/constants.js';
import {
  clearTable,
  copyDatabaseFile,
  countRows,
  getColumns,
  insertBatch,
  iterateBatched,
  openReadonlyCopy,
  openWritable,
  tableExists,
} from '../database/sqlite.js';
import { reencryptValue } from '../services/crypto.js';
import type { StageResult } from '../types/index.js';
import { logSkip } from '../utils/logger.js';
import { BaseMigrator, type MigratorContext } from './base.js';

/**
 * Password migration.
 * - Never writes plaintext passwords to disk or logs.
 * - Decrypts with Arc Safe Storage key, re-encrypts with Brave key in memory.
 * - Falls back to raw encrypted blob copy if keys are identical / reencrypt fails.
 */
export class PasswordsMigrator extends BaseMigrator {
  readonly stage = 'passwords' as const;
  readonly label = 'Migrating passwords';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!(await fs.pathExists(ctx.source.loginData))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Login Data database found'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(ctx.source.loginData);
    let found = 0;
    try {
      if (tableExists(src.db, 'logins')) found = countRows(src.db, 'logins');
    } finally {
      await src.close();
    }

    if (ctx.dryRun) {
      const canReencrypt = Boolean(ctx.sourceSafeKey && ctx.targetSafeKey);
      if (!canReencrypt) {
        warnings.push(
          'Safe Storage keys unavailable — dry-run assumes file-copy of encrypted blobs',
        );
      }
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { dryRun: true, reencrypt: canReencrypt },
      };
    }

    // If we cannot re-encrypt, copy the DB as-is (works if same OS keychain material
    // or user accepts that Brave may need the Arc key — we still try reencrypt path).
    if (!ctx.sourceSafeKey || !ctx.targetSafeKey) {
      warnings.push(
        'Could not resolve Safe Storage keys; copying Login Data encrypted blobs as-is',
      );
      await copyDatabaseFile(ctx.source.loginData, ctx.target.loginData);
      // Also copy account logins if present
      const accountSrc = ctx.source.loginData + ' For Account';
      if (await fs.pathExists(accountSrc)) {
        await copyDatabaseFile(accountSrc, ctx.target.loginData + ' For Account');
      }
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { method: 'encrypted-blob-copy' },
      };
    }

    return this.reencryptAndWrite(ctx, found, warnings, errors);
  }

  private async reencryptAndWrite(
    ctx: MigratorContext,
    found: number,
    warnings: string[],
    errors: string[],
  ): Promise<Partial<StageResult>> {
    const sourceKey = ctx.sourceSafeKey!;
    const targetKey = ctx.targetSafeKey!;

    // Start from a full copy to preserve schema, then rewrite password_value blobs
    await copyDatabaseFile(ctx.source.loginData, ctx.target.loginData);

    const dest = await openWritable(ctx.target.loginData);
    let transferred = 0;
    let failed = 0;
    let skipped = 0;

    try {
      if (!tableExists(dest, 'logins')) {
        errors.push('Target Login Data missing logins table');
        return { itemsFound: found, itemsTransferred: 0, itemsSkipped: 0, itemsFailed: found, warnings, errors };
      }

      const cols = getColumns(dest, 'logins');
      if (!cols.includes('password_value') || !cols.includes('id')) {
        warnings.push('Unexpected Login Data schema; leaving encrypted blobs unchanged');
        return {
          itemsFound: found,
          itemsTransferred: found,
          itemsSkipped: 0,
          itemsFailed: 0,
          warnings,
          errors,
          details: { method: 'schema-passthrough' },
        };
      }

      const rows = dest.prepare('SELECT id, password_value FROM logins').all() as Array<{
        id: number;
        password_value: Buffer | null;
      }>;

      ctx.ui.startBar(rows.length || 1, 'passwords');
      const update = dest.prepare('UPDATE logins SET password_value = ? WHERE id = ?');

      const tx = dest.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          ctx.ui.updateBar(i + 1, `login #${row.id}`);

          if (!row.password_value || row.password_value.length === 0) {
            skipped++;
            transferred++;
            continue;
          }

          const reencrypted = reencryptValue(row.password_value, sourceKey, targetKey);
          if (!reencrypted) {
            // Keep original blob; may still work if keys match
            logSkip(`login:${row.id}`, 'reencrypt failed; keeping original ciphertext');
            skipped++;
            failed++;
            continue;
          }

          update.run(reencrypted, row.id);
          // Zero the buffer
          reencrypted.fill(0);
          transferred++;
        }
      });
      tx();
      ctx.ui.stopBar();

      // Migrate blacklisted / stats tables if present via remaining copy (already in file)
      // Migrate "Login Data For Account" similarly
      const accountSrc = ctx.source.loginData.replace(/Login Data$/, 'Login Data For Account');
      if (await fs.pathExists(accountSrc)) {
        await this.migrateAccountLogins(accountSrc, ctx, sourceKey, targetKey, warnings);
      }
    } catch (err) {
      errors.push(String(err));
    } finally {
      dest.close();
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: skipped,
      itemsFailed: failed,
      warnings,
      errors,
      details: { method: 'reencrypt' },
    };
  }

  private async migrateAccountLogins(
    accountSrc: string,
    ctx: MigratorContext,
    sourceKey: Buffer,
    targetKey: Buffer,
    warnings: string[],
  ): Promise<void> {
    const destPath = ctx.target.loginData.replace(/Login Data$/, 'Login Data For Account');
    await copyDatabaseFile(accountSrc, destPath);
    try {
      const dest = await openWritable(destPath);
      try {
        if (!tableExists(dest, 'logins')) return;
        const rows = dest.prepare('SELECT id, password_value FROM logins').all() as Array<{
          id: number;
          password_value: Buffer | null;
        }>;
        const update = dest.prepare('UPDATE logins SET password_value = ? WHERE id = ?');
        dest.transaction(() => {
          for (const row of rows) {
            if (!row.password_value?.length) continue;
            const re = reencryptValue(row.password_value, sourceKey, targetKey);
            if (re) {
              update.run(re, row.id);
              re.fill(0);
            }
          }
        })();
      } finally {
        dest.close();
      }
    } catch (err) {
      warnings.push(`Account logins migration warning: ${String(err)}`);
    }
  }
}

/**
 * Alternative path used when target Login Data must be built from scratch.
 */
export async function mergeLoginsRowByRow(
  sourcePath: string,
  targetPath: string,
  sourceKey: Buffer,
  targetKey: Buffer,
): Promise<{ transferred: number; failed: number }> {
  const src = await openReadonlyCopy(sourcePath);
  let transferred = 0;
  let failed = 0;
  try {
    const dest = await openWritable(targetPath);
    try {
      if (!tableExists(src.db, 'logins') || !tableExists(dest, 'logins')) {
        return { transferred: 0, failed: 0 };
      }
      clearTable(dest, 'logins');
      for (const batch of iterateBatched<Record<string, unknown>>(
        src.db,
        'logins',
        BATCH_SIZE.passwords,
      )) {
        const rewritten = batch.map((row) => {
          const next = { ...row };
          const pv = row.password_value;
          if (Buffer.isBuffer(pv) && pv.length > 0) {
            const re = reencryptValue(pv, sourceKey, targetKey);
            if (re) {
              next.password_value = re;
              transferred++;
            } else {
              failed++;
            }
          } else {
            transferred++;
          }
          return next;
        });
        insertBatch(dest, 'logins', rewritten, { replace: true, skipColumns: ['id'] });
        // scrub temporary buffers
        for (const r of rewritten) {
          if (Buffer.isBuffer(r.password_value)) (r.password_value as Buffer).fill(0);
        }
      }
    } finally {
      dest.close();
    }
  } finally {
    await src.close();
  }
  return { transferred, failed };
}
