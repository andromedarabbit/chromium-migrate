import fs from 'fs-extra';
import type { StageResult } from '../types/index.js';
import { safeJsonParse } from '../utils/helpers.js';
import { BaseMigrator, type MigratorContext } from './base.js';

/** Permission-related preference keys under profile.content_settings */
const PERMISSION_PATTERNS = [
  'media_stream_camera',
  'media_stream_mic',
  'notifications',
  'geolocation',
  'clipboard',
  'clipboard_read_write',
  'popups',
  'midi_sysex',
  'usb_chooser_data',
  'serial_chooser_data',
  'bluetooth_chooser_data',
  'protected_media_identifier',
  'sound',
  'automatic_downloads',
  'autoplay',
  'file_system_write_guard',
  'file_system_last_picked_directory',
  'window_placement',
  'idle_detection',
  'sensors',
  'important_site_info',
];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function deepGet(obj: Json, pathParts: string[]): Json | undefined {
  let cur: Json | undefined = obj;
  for (const p of pathParts) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, Json>)[p];
  }
  return cur;
}

function deepSet(obj: Record<string, Json>, pathParts: string[], value: Json): void {
  let cur: Record<string, Json> = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const key = pathParts[i]!;
    const next = cur[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, Json>;
  }
  cur[pathParts[pathParts.length - 1]!] = value;
}

function countSettings(exceptions: unknown): number {
  if (!exceptions || typeof exceptions !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(exceptions as Record<string, unknown>)) {
    if (v && typeof v === 'object') n += Object.keys(v as object).length;
  }
  return n;
}

export class PermissionsMigrator extends BaseMigrator {
  readonly stage = 'permissions' as const;
  readonly label = 'Migrating site permissions';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!(await fs.pathExists(ctx.source.preferences))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Preferences file found'],
        errors: [],
      };
    }

    const srcRaw = await fs.readFile(ctx.source.preferences, 'utf8');
    const srcPrefs = safeJsonParse<Record<string, Json>>(srcRaw, {});

    const exceptions = deepGet(srcPrefs, ['profile', 'content_settings', 'exceptions']);
    const found = countSettings(exceptions);

    // Also count pattern-specific keys
    let patternHits = 0;
    if (exceptions && typeof exceptions === 'object' && !Array.isArray(exceptions)) {
      for (const key of Object.keys(exceptions)) {
        if (PERMISSION_PATTERNS.some((p) => key.includes(p) || key === p)) patternHits++;
      }
    }

    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { dryRun: true, permissionTypes: patternHits },
      };
    }

    let destPrefs: Record<string, Json> = {};
    if (await fs.pathExists(ctx.target.preferences)) {
      destPrefs = safeJsonParse(await fs.readFile(ctx.target.preferences, 'utf8'), {});
    }

    if (exceptions) {
      deepSet(destPrefs, ['profile', 'content_settings', 'exceptions'], exceptions);
    }

    // Copy default content settings
    const defaults = deepGet(srcPrefs, ['profile', 'default_content_setting_values']);
    if (defaults) {
      deepSet(destPrefs, ['profile', 'default_content_setting_values'], defaults);
    }

    const pattern = deepGet(srcPrefs, ['profile', 'content_settings', 'pattern_pairs']);
    if (pattern) {
      deepSet(destPrefs, ['profile', 'content_settings', 'pattern_pairs'], pattern);
    }

    await fs.ensureDir(ctx.target.path);
    await fs.writeFile(ctx.target.preferences, JSON.stringify(destPrefs), 'utf8');

    // Verify
    const verify = safeJsonParse<Record<string, Json>>(
      await fs.readFile(ctx.target.preferences, 'utf8'),
      {},
    );
    const transferred = countSettings(
      deepGet(verify, ['profile', 'content_settings', 'exceptions']),
    );

    if (transferred < found) {
      warnings.push(`Permission entries: source=${found}, target=${transferred}`);
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: 0,
      itemsFailed: 0,
      warnings,
      errors,
      details: { permissionTypes: patternHits },
    };
  }
}
