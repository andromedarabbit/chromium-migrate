import fs from 'fs-extra';
import path from 'node:path';
import type { StageResult } from '../types/index.js';
import { copyIfExists } from '../utils/helpers.js';
import { BaseMigrator, type MigratorContext } from './base.js';

const SESSION_FILES = [
  'Current Session',
  'Current Tabs',
  'Last Session',
  'Last Tabs',
  'Sessions',
] as const;

export class SessionsMigrator extends BaseMigrator {
  readonly stage = 'sessions' as const;
  readonly label = 'Migrating sessions';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];
    let found = 0;
    let transferred = 0;
    let failed = 0;

    const present: string[] = [];
    for (const name of SESSION_FILES) {
      const src = path.join(ctx.source.path, name);
      if (await fs.pathExists(src)) {
        found++;
        present.push(name);
      }
    }

    // Also count Session Storage / Tabs in Preferences later
    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: found
          ? warnings
          : ['No session files found — Brave may start with empty windows'],
        errors,
        details: { dryRun: true, files: present },
      };
    }

    for (const name of present) {
      try {
        const src = path.join(ctx.source.path, name);
        const dest = path.join(ctx.target.path, name);
        await fs.copy(src, dest, { overwrite: true, dereference: true });
        transferred++;
      } catch (err) {
        failed++;
        errors.push(`${name}: ${String(err)}`);
      }
    }

    // Visited Links helps with autocomplete underline styling
    await copyIfExists(
      path.join(ctx.source.path, 'Visited Links'),
      path.join(ctx.target.path, 'Visited Links'),
    );

    if (found === 0) {
      warnings.push('No session/tab files to migrate');
    } else {
      warnings.push(
        'Pinned tabs and tab groups restore best when Brave is launched with the migrated profile',
      );
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: 0,
      itemsFailed: failed,
      warnings,
      errors,
      details: { files: present },
    };
  }
}
