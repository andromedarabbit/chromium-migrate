import fs from 'fs-extra';
import {
  copyDatabaseFile,
  countRows,
  openReadonlyCopy,
  tableExists,
} from '../database/sqlite.js';
import type { StageResult } from '../types/index.js';
import { copyIfExists } from '../utils/helpers.js';
import { BaseMigrator, type MigratorContext } from './base.js';

export class FaviconsMigrator extends BaseMigrator {
  readonly stage = 'favicons' as const;
  readonly label = 'Migrating favicons';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!(await fs.pathExists(ctx.source.favicons))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Favicons database found'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(ctx.source.favicons);
    let found = 0;
    let iconBlobs = 0;
    try {
      if (tableExists(src.db, 'favicons')) found = countRows(src.db, 'favicons');
      if (tableExists(src.db, 'favicon_bitmaps'))
        iconBlobs = countRows(src.db, 'favicon_bitmaps');
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
        details: { dryRun: true, bitmaps: iconBlobs },
      };
    }

    const ok = await copyDatabaseFile(ctx.source.favicons, ctx.target.favicons);
    if (!ok) {
      errors.push('Failed to copy Favicons database');
      return {
        itemsFound: found,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 1,
        warnings,
        errors,
      };
    }

    // Top Sites
    await copyIfExists(ctx.source.topSites, ctx.target.topSites);

    // Shortcuts (omnibox)
    await copyIfExists(ctx.source.shortcuts, ctx.target.shortcuts);

    let transferred = 0;
    const dest = await openReadonlyCopy(ctx.target.favicons);
    try {
      if (tableExists(dest.db, 'favicons')) transferred = countRows(dest.db, 'favicons');
      if (tableExists(dest.db, 'favicon_bitmaps')) {
        const bitmaps = countRows(dest.db, 'favicon_bitmaps');
        if (bitmaps !== iconBlobs) {
          warnings.push(`Favicon bitmap count: source=${iconBlobs}, target=${bitmaps}`);
        }
      }
    } finally {
      await dest.close();
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: 0,
      itemsFailed: transferred === found ? 0 : 1,
      warnings,
      errors,
      details: { bitmaps: iconBlobs, verified: transferred === found },
    };
  }
}

export class TopSitesMigrator extends BaseMigrator {
  readonly stage = 'top-sites' as const;
  readonly label = 'Migrating top sites';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    if (!(await fs.pathExists(ctx.source.topSites))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Top Sites database'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(ctx.source.topSites);
    let found = 0;
    try {
      if (tableExists(src.db, 'top_sites')) found = countRows(src.db, 'top_sites');
      else if (tableExists(src.db, 'topsites')) found = countRows(src.db, 'topsites');
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
        details: { dryRun: true },
      };
    }

    await copyDatabaseFile(ctx.source.topSites, ctx.target.topSites);
    return {
      itemsFound: found,
      itemsTransferred: found,
      itemsSkipped: 0,
      itemsFailed: 0,
      warnings,
      errors: [],
    };
  }
}
