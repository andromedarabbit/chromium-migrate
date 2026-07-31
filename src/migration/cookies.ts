import fs from 'fs-extra';
import path from 'node:path';
import { BATCH_SIZE } from '../core/constants.js';
import {
  copyDatabaseFile,
  countRows,
  getColumns,
  openReadonlyCopy,
  openWritable,
  tableExists,
} from '../database/sqlite.js';
import { reencryptValue } from '../services/crypto.js';
import type { StageResult } from '../types/index.js';
import { logSkip } from '../utils/logger.js';
import { BaseMigrator, type MigratorContext } from './base.js';

export class CookiesMigrator extends BaseMigrator {
  readonly stage = 'cookies' as const;
  readonly label = 'Migrating cookies';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    const sourceCookies = ctx.source.cookies;
    if (!(await fs.pathExists(sourceCookies))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Cookies database found'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(sourceCookies);
    let found = 0;
    try {
      if (tableExists(src.db, 'cookies')) found = countRows(src.db, 'cookies');
    } finally {
      await src.close();
    }

    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ctx.sourceSafeKey && ctx.targetSafeKey
          ? warnings
          : [...warnings, 'Safe Storage keys unavailable — encrypted cookie values copied as-is'],
        errors,
        details: { dryRun: true },
      };
    }

    // Ensure Network directory exists for modern Chromium layout
    const targetCookies = ctx.target.cookies.includes(`${path.sep}Network${path.sep}`)
      ? ctx.target.cookies
      : path.join(ctx.target.path, 'Network', 'Cookies');

    await fs.ensureDir(path.dirname(targetCookies));
    await copyDatabaseFile(sourceCookies, targetCookies);

    // Also place a legacy Cookies file for older Brave builds
    if (targetCookies !== ctx.target.cookies) {
      await copyDatabaseFile(sourceCookies, path.join(ctx.target.path, 'Cookies')).catch(() => undefined);
    }

    if (!ctx.sourceSafeKey || !ctx.targetSafeKey) {
      warnings.push('Cookie encrypted values copied without re-encryption (keys unavailable)');
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { method: 'encrypted-blob-copy', path: targetCookies },
      };
    }

    return this.reencryptCookies(targetCookies, found, ctx, warnings, errors);
  }

  private async reencryptCookies(
    targetCookies: string,
    found: number,
    ctx: MigratorContext,
    warnings: string[],
    errors: string[],
  ): Promise<Partial<StageResult>> {
    const sourceKey = ctx.sourceSafeKey!;
    const targetKey = ctx.targetSafeKey!;
    let transferred = 0;
    let failed = 0;
    let skipped = 0;

    try {
      const dest = await openWritable(targetCookies);
      try {
        if (!tableExists(dest, 'cookies')) {
          errors.push('Target cookies table missing');
          return { itemsFound: found, itemsTransferred: 0, itemsSkipped: 0, itemsFailed: found, warnings, errors };
        }

        const cols = getColumns(dest, 'cookies');
        const hasEncrypted = cols.includes('encrypted_value');
        if (!hasEncrypted) {
          warnings.push('No encrypted_value column; cookies left as copied');
          return {
            itemsFound: found,
            itemsTransferred: found,
            itemsSkipped: 0,
            itemsFailed: 0,
            warnings,
            errors,
          };
        }

        // Use rowid for updates
        const rows = dest
          .prepare('SELECT rowid, encrypted_value, value FROM cookies')
          .all() as Array<{ rowid: number; encrypted_value: Buffer | null; value: string }>;

        ctx.ui.startBar(Math.max(rows.length, 1), 'cookies');
        const update = dest.prepare(
          'UPDATE cookies SET encrypted_value = ?, value = ? WHERE rowid = ?',
        );

        let processed = 0;
        for (let i = 0; i < rows.length; i += BATCH_SIZE.cookies) {
          const batch = rows.slice(i, i + BATCH_SIZE.cookies);
          dest.transaction(() => {
            for (const row of batch) {
              processed++;
              if (processed % 500 === 0) ctx.ui.updateBar(processed, 're-encrypting');

              if (!row.encrypted_value || row.encrypted_value.length === 0) {
                // Plaintext value already present
                skipped++;
                transferred++;
                continue;
              }

              const re = reencryptValue(row.encrypted_value, sourceKey, targetKey);
              if (!re) {
                logSkip(`cookie:rowid=${row.rowid}`, 'reencrypt failed');
                failed++;
                continue;
              }

              // Keep value column empty (Chromium preference for encrypted storage)
              update.run(re, '', row.rowid);
              re.fill(0);
              transferred++;
            }
          })();
          ctx.ui.updateBar(Math.min(i + batch.length, rows.length), 're-encrypting');
        }
        ctx.ui.stopBar();
      } finally {
        dest.close();
      }
    } catch (err) {
      errors.push(String(err));
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: skipped,
      itemsFailed: failed,
      warnings,
      errors,
      details: { method: 'reencrypt', path: targetCookies },
    };
  }
}
