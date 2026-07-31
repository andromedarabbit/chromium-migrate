import fs from 'fs-extra';
import { BATCH_SIZE } from '../core/constants.js';
import {
  clearTable,
  copyDatabaseFile,
  countRows,
  insertBatch,
  iterateBatched,
  openReadonlyCopy,
  openWritable,
  tableExists,
} from '../database/sqlite.js';
import type { StageResult } from '../types/index.js';
import { BaseMigrator, type MigratorContext } from './base.js';

const HISTORY_TABLES = [
  'urls',
  'visits',
  'visit_source',
  'keyword_search_terms',
  'downloads',
  'downloads_url_chains',
  'downloads_slices',
  'segments',
  'segment_usage',
  'content_annotations',
  'context_annotations',
  'clusters',
  'clusters_and_visits',
] as const;

export class HistoryMigrator extends BaseMigrator {
  readonly stage = 'history' as const;
  readonly label = 'Migrating history';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!(await fs.pathExists(ctx.source.history))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No History database found'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(ctx.source.history);
    let found = 0;
    try {
      if (tableExists(src.db, 'urls')) found = countRows(src.db, 'urls');
    } finally {
      await src.close();
    }

    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { dryRun: true },
      };
    }

    // Prefer full DB copy for schema fidelity, then verify
    const copied = await copyDatabaseFile(ctx.source.history, ctx.target.history);
    if (copied) {
      // Copy journal if present
      if (await fs.pathExists(ctx.source.historyJournal)) {
        await fs.copy(ctx.source.historyJournal, ctx.target.historyJournal, { overwrite: true });
      }

      const dest = await openReadonlyCopy(ctx.target.history);
      let transferred = 0;
      try {
        if (tableExists(dest.db, 'urls')) transferred = countRows(dest.db, 'urls');
      } finally {
        await dest.close();
      }

      return {
        itemsFound: found,
        itemsTransferred: transferred,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { method: 'file-copy' },
      };
    }

    // Fallback: row-by-row merge into existing Brave History
    return this.mergeHistory(ctx, found, warnings, errors);
  }

  private async mergeHistory(
    ctx: MigratorContext,
    found: number,
    warnings: string[],
    errors: string[],
  ): Promise<Partial<StageResult>> {
    const src = await openReadonlyCopy(ctx.source.history);
    let transferred = 0;
    try {
      // If target doesn't exist, just copy
      if (!(await fs.pathExists(ctx.target.history))) {
        await src.close();
        await copyDatabaseFile(ctx.source.history, ctx.target.history);
        return {
          itemsFound: found,
          itemsTransferred: found,
          itemsSkipped: 0,
          itemsFailed: 0,
          warnings,
          errors,
        };
      }

      const dest = await openWritable(ctx.target.history);
      try {
        ctx.ui.startBar(HISTORY_TABLES.length, 'history');
        let step = 0;
        for (const table of HISTORY_TABLES) {
          step++;
          ctx.ui.updateBar(step, table);
          if (!tableExists(src.db, table) || !tableExists(dest, table)) {
            warnings.push(`Skipped table ${table} (missing in source or target)`);
            continue;
          }
          clearTable(dest, table);
          for (const batch of iterateBatched<Record<string, unknown>>(
            src.db,
            table,
            BATCH_SIZE.history,
          )) {
            transferred += insertBatch(dest, table, batch, { replace: true });
          }
        }
        ctx.ui.stopBar();
      } finally {
        dest.close();
      }
    } catch (err) {
      errors.push(String(err));
    } finally {
      await src.close();
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred > 0 ? found : 0,
      itemsSkipped: 0,
      itemsFailed: errors.length,
      warnings,
      errors,
      details: { method: 'merge' },
    };
  }
}

export class DownloadsMigrator extends BaseMigrator {
  readonly stage = 'downloads' as const;
  readonly label = 'Migrating downloads';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    // Downloads live inside History DB; HistoryMigrator already copies them.
    // This stage reports counts for the migration report.
    const warnings: string[] = [];
    if (!(await fs.pathExists(ctx.source.history))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No History DB for downloads'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(ctx.source.history);
    let found = 0;
    try {
      if (tableExists(src.db, 'downloads')) found = countRows(src.db, 'downloads');
    } finally {
      await src.close();
    }

    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors: [],
        details: { dryRun: true, note: 'Included in History migration' },
      };
    }

    let transferred = 0;
    if (await fs.pathExists(ctx.target.history)) {
      const dest = await openReadonlyCopy(ctx.target.history);
      try {
        if (tableExists(dest.db, 'downloads')) transferred = countRows(dest.db, 'downloads');
      } finally {
        await dest.close();
      }
    }

    if (transferred === 0 && found > 0) {
      warnings.push('Downloads not yet present in target; ensure History migrator ran first');
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: 0,
      itemsFailed: 0,
      warnings,
      errors: [],
      details: { note: 'Downloads transferred via History database' },
    };
  }
}
