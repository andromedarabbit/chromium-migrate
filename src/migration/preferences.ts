import fs from 'fs-extra';
import type { StageResult } from '../types/index.js';
import { safeJsonParse } from '../utils/helpers.js';
import { BaseMigrator, type MigratorContext } from './base.js';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Preference paths to transfer (dot-path). Brave-incompatible Arc-only keys are excluded. */
const TRANSFER_KEYS: string[][] = [
  ['browser', 'theme'],
  ['browser', 'show_home_button'],
  ['homepage'],
  ['homepage_is_newtabpage'],
  ['session', 'restore_on_startup'],
  ['session', 'startup_urls'],
  ['default_search_provider_data'],
  ['default_search_provider'],
  ['search_provider_overrides'],
  ['download', 'default_directory'],
  ['download', 'prompt_for_download'],
  ['intl', 'accept_languages'],
  ['intl', 'selected_languages'],
  ['webkit', 'webprefs', 'default_font_size'],
  ['webkit', 'webprefs', 'default_fixed_font_size'],
  ['webkit', 'webprefs', 'minimum_font_size'],
  ['partition', 'per_host_zoom_levels'],
  ['profile', 'default_zoom_level'],
  ['profile', 'password_manager_enabled'],
  ['profile', 'exit_type'],
  ['autofill', 'profile_enabled'],
  ['autofill', 'credit_card_enabled'],
  ['enable_do_not_track'],
  ['safebrowsing'],
  ['dns_prefetching'],
  ['alternate_error_pages'],
  ['bookmark_bar'],
  ['toolbar'],
  ['extensions', 'settings'],
  ['extensions', 'theme'],
  ['extensions', 'pinned_extensions'],
  ['extensions', 'commands'],
  ['media', 'hardware_media_key_handling'],
  ['webrtc'],
  ['content_settings'],
  ['spellcheck'],
  ['translate'],
  ['notifications'],
  ['accessibility'],
  ['apps'],
];

/** Keys that are Arc-specific and should not be copied blindly */
const BLOCKLIST_PREFIXES = [
  'arc',
  'company.thebrowser',
  'sidebar', // Arc sidebar model differs
  'spaces',
  'boosts',
  'easels',
  'little_arc',
];

function deepGet(obj: Json, parts: string[]): Json | undefined {
  let cur: Json | undefined = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, Json>)[p];
  }
  return cur;
}

function deepSet(obj: Record<string, Json>, parts: string[], value: Json): void {
  let cur: Record<string, Json> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (cur[key] === null || typeof cur[key] !== 'object' || Array.isArray(cur[key])) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, Json>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function isBlockedKey(parts: string[]): boolean {
  const joined = parts.join('.').toLowerCase();
  return BLOCKLIST_PREFIXES.some((b) => joined.startsWith(b) || joined.includes(`.${b}`));
}

export class PreferencesMigrator extends BaseMigrator {
  readonly stage = 'preferences' as const;
  readonly label = 'Migrating preferences';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];
    let found = 0;
    let transferred = 0;
    let skipped = 0;

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

    const srcPrefs = safeJsonParse<Record<string, Json>>(
      await fs.readFile(ctx.source.preferences, 'utf8'),
      {},
    );

    const transferable: Array<{ path: string[]; value: Json }> = [];
    for (const keyPath of TRANSFER_KEYS) {
      if (isBlockedKey(keyPath)) {
        skipped++;
        continue;
      }
      const value = deepGet(srcPrefs, keyPath);
      if (value !== undefined) {
        found++;
        transferable.push({ path: keyPath, value });
      }
    }

    // Experimental flags that are Chromium-compatible
    const enabledLabs = deepGet(srcPrefs, ['browser', 'enabled_labs_experiments']);
    if (Array.isArray(enabledLabs)) {
      found++;
      transferable.push({ path: ['browser', 'enabled_labs_experiments'], value: enabledLabs });
      warnings.push('Experimental flags copied; some may be ignored by Brave');
    }

    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: skipped,
        itemsFailed: 0,
        warnings: [
          ...warnings,
          'Arc-specific UI preferences (Spaces, Boosts, sidebar) are not transferable',
        ],
        errors,
        details: { dryRun: true, keys: transferable.map((t) => t.path.join('.')) },
      };
    }

    let destPrefs: Record<string, Json> = {};
    if (await fs.pathExists(ctx.target.preferences)) {
      destPrefs = safeJsonParse(await fs.readFile(ctx.target.preferences, 'utf8'), {});
    }

    for (const item of transferable) {
      try {
        deepSet(destPrefs, item.path, item.value);
        transferred++;
      } catch (err) {
        errors.push(`${item.path.join('.')}: ${String(err)}`);
      }
    }

    // Preserve Brave-specific identity keys if present
    // (do not overwrite brave profile GUID etc. if already set — already merged into dest)

    await fs.ensureDir(ctx.target.path);
    await fs.writeFile(ctx.target.preferences, JSON.stringify(destPrefs), 'utf8');

    // Secure Preferences — copy carefully (extension force-lists etc.)
    if (await fs.pathExists(ctx.source.securePreferences)) {
      try {
        const secureSrc = safeJsonParse<Record<string, Json>>(
          await fs.readFile(ctx.source.securePreferences, 'utf8'),
          {},
        );
        let secureDest: Record<string, Json> = {};
        if (await fs.pathExists(ctx.target.securePreferences)) {
          secureDest = safeJsonParse(
            await fs.readFile(ctx.target.securePreferences, 'utf8'),
            {},
          );
        }
        const extSettings = deepGet(secureSrc, ['extensions', 'settings']);
        if (extSettings) {
          deepSet(secureDest, ['extensions', 'settings'], extSettings);
          transferred++;
          found++;
        }
        await fs.writeFile(ctx.target.securePreferences, JSON.stringify(secureDest), 'utf8');
      } catch (err) {
        warnings.push(`Secure Preferences partial: ${String(err)}`);
      }
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: skipped,
      itemsFailed: errors.length,
      warnings,
      errors,
      details: {
        transferredKeys: transferable.map((t) => t.path.join('.')),
      },
    };
  }
}
