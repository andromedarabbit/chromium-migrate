import fs from 'fs-extra';
import path from 'node:path';
import type { ExtensionCompatInfo, StageResult } from '../types/index.js';
import { copyIfExists, safeJsonParse } from '../utils/helpers.js';
import { BaseMigrator, type MigratorContext } from './base.js';

interface ExtensionManifest {
  name?: string;
  version?: string;
  manifest_version?: number;
  description?: string;
}

export class ExtensionsMigrator extends BaseMigrator {
  readonly stage = 'extensions' as const;
  readonly label = 'Migrating extensions';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const compat: ExtensionCompatInfo[] = [];

    const srcExt = ctx.source.extensions;
    if (!(await fs.pathExists(srcExt))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Extensions directory found'],
        errors: [],
      };
    }

    const extensionIds = (await fs.readdir(srcExt)).filter((n) => !n.startsWith('.'));
    const found = extensionIds.length;

    if (ctx.dryRun) {
      for (const id of extensionIds) {
        const info = await this.inspectExtension(path.join(srcExt, id), id);
        compat.push(info);
      }
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { dryRun: true, compatibility: compat },
      };
    }

    await fs.ensureDir(ctx.target.extensions);
    let transferred = 0;
    let failed = 0;

    ctx.ui.startBar(Math.max(found, 1), 'extensions');
    for (let i = 0; i < extensionIds.length; i++) {
      const id = extensionIds[i]!;
      ctx.ui.updateBar(i + 1, id);
      try {
        const src = path.join(srcExt, id);
        const dest = path.join(ctx.target.extensions, id);
        await fs.copy(src, dest, { overwrite: true, dereference: true });

        const info = await this.inspectExtension(dest, id);
        info.transferred = true;
        info.dataRestored = false;
        compat.push(info);
        transferred++;
      } catch (err) {
        failed++;
        errors.push(`${id}: ${String(err)}`);
        compat.push({
          id,
          name: id,
          transferred: false,
          compatible: false,
          warnings: [String(err)],
          dataRestored: false,
        });
      }
    }
    ctx.ui.stopBar();

    // Extension state / settings / rules
    const sideChannels: Array<[string, string, string]> = [
      [ctx.source.extensionState, ctx.target.extensionState, 'Extension State'],
      [ctx.source.extensionRules, ctx.target.extensionRules, 'Extension Rules'],
      [
        ctx.source.localExtensionSettings,
        ctx.target.localExtensionSettings,
        'Local Extension Settings',
      ],
      [
        ctx.source.syncExtensionSettings,
        ctx.target.syncExtensionSettings,
        'Sync Extension Settings',
      ],
      [
        path.join(ctx.source.path, 'Managed Extension Settings'),
        path.join(ctx.target.path, 'Managed Extension Settings'),
        'Managed Extension Settings',
      ],
      [
        path.join(ctx.source.path, 'Extension Scripts'),
        path.join(ctx.target.path, 'Extension Scripts'),
        'Extension Scripts',
      ],
      [
        path.join(ctx.source.path, 'Extension Rules'),
        path.join(ctx.target.path, 'Extension Rules'),
        'Extension Rules',
      ],
    ];

    for (const [src, dest, label] of sideChannels) {
      const ok = await copyIfExists(src, dest);
      if (ok) {
        // Mark data restored for all transferred extensions
        for (const c of compat) {
          if (c.transferred) c.dataRestored = true;
        }
      } else {
        warnings.push(`${label} not present in source`);
      }
    }

    // Preferences may also hold extension settings — Preferences migrator handles that.
    const incompatible = compat.filter((c) => !c.compatible);
    if (incompatible.length) {
      warnings.push(
        `${incompatible.length} extension(s) may need manual enablement in Brave`,
      );
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: 0,
      itemsFailed: failed,
      warnings,
      errors,
      details: { compatibility: compat },
    };
  }

  private async inspectExtension(extDir: string, id: string): Promise<ExtensionCompatInfo> {
    const warnings: string[] = [];
    let name = id;
    let version: string | undefined;
    let compatible = true;

    // Extension dirs contain version subfolders
    try {
      const versions = (await fs.readdir(extDir)).filter((n) => !n.startsWith('.'));
      if (versions.length === 0) {
        return {
          id,
          name,
          transferred: false,
          compatible: false,
          warnings: ['Empty extension directory'],
          dataRestored: false,
        };
      }
      // Pick highest version-ish folder
      const versionDir = path.join(extDir, versions.sort().at(-1)!);
      const manifestPath = path.join(versionDir, 'manifest.json');
      if (await fs.pathExists(manifestPath)) {
        const raw = await fs.readFile(manifestPath, 'utf8');
        const manifest = safeJsonParse<ExtensionManifest>(raw, {});
        name = manifest.name ?? id;
        version = manifest.version;
        if (manifest.manifest_version === 2) {
          warnings.push('MV2 extension — Brave may disable it depending on policy');
          compatible = true; // still transferable
        }
        // Arc-only extensions (unlikely in Chrome Web Store IDs)
        if (name.toLowerCase().includes('arc') && id.length < 32) {
          warnings.push('Possibly Arc-specific extension');
          compatible = false;
        }
      }
    } catch (err) {
      warnings.push(String(err));
      compatible = false;
    }

    return {
      id,
      name,
      version,
      transferred: false,
      compatible,
      warnings,
      dataRestored: false,
    };
  }
}
