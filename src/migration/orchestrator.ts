import fs from 'fs-extra';
import { z } from 'zod';
import {
  discoverBrowser,
  ensureTargetProfile,
  resolveCookiesPath,
  resolveProfile,
} from '../browsers/discovery.js';
import { listBrowserIds, resolveBrowserId } from '../browsers/registry.js';
import { ensureBrowsersClosed } from '../browsers/process.js';
import {
  APP_VERSION,
  DEFAULT_MIGRATION_OPTIONS,
  type DryRunEstimate,
  type MigrationOptions,
  type MigrationReport,
  type MigrationSummary,
  type StageResult,
  type CountSummary,
} from '../types/index.js';
import { createBackup } from '../services/backup.js';
import {
  ensureBrowserSafeStoragePassword,
  getBrowserSafeStorageKey,
  supportsSecretReencryption,
} from '../services/crypto.js';
import { BookmarksMigrator } from './bookmarks.js';
import { HistoryMigrator, DownloadsMigrator } from './history.js';
import { PasswordsMigrator } from './passwords.js';
import { CookiesMigrator } from './cookies.js';
import { AutofillMigrator } from './autofill.js';
import { ExtensionsMigrator } from './extensions.js';
import { SessionsMigrator } from './sessions.js';
import { PermissionsMigrator } from './permissions.js';
import { PreferencesMigrator } from './preferences.js';
import { FaviconsMigrator, TopSitesMigrator } from './favicons.js';
import type { BaseMigrator, MigratorContext } from './base.js';
import { ProgressUI } from '../utils/progress.js';
import {
  assertSupportedPlatform,
  estimateMigrationTimeMs,
  formatBytes,
  generateId,
  getAvailableDiskBytes,
  getDirectorySize,
  nowIso,
} from '../utils/helpers.js';
import { getLogger, initLogger } from '../utils/logger.js';
import { generateReports } from '../reports/generator.js';
import { verifyMigration } from './verify.js';
import { PATHS } from '../core/constants.js';

const browserIdSchema = z.string().refine(
  (v) => {
    try {
      resolveBrowserId(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: `Unknown browser. Supported: ${listBrowserIds().join(', ')}` },
);

export const MigrationOptionsSchema = z.object({
  sourceBrowser: browserIdSchema.default('chrome'),
  targetBrowser: browserIdSchema.default('brave'),
  sourceProfile: z.string().default('Default'),
  targetProfile: z.string().default('Default'),
  dryRun: z.boolean().default(false),
  skipBackup: z.boolean().default(false),
  force: z.boolean().default(false),
  includePasswords: z.boolean().default(true),
  includeCookies: z.boolean().default(true),
  includeExtensions: z.boolean().default(true),
  includeHistory: z.boolean().default(true),
  includeBookmarks: z.boolean().default(true),
  includeAutofill: z.boolean().default(true),
  includeSessions: z.boolean().default(true),
  includePermissions: z.boolean().default(true),
  includePreferences: z.boolean().default(true),
  includeDownloads: z.boolean().default(true),
  includeFavicons: z.boolean().default(true),
  terminateBrowsers: z.boolean().default(false),
  continueOnError: z.boolean().default(true),
  verbose: z.boolean().default(false),
  reportFormats: z
    .array(z.enum(['json', 'markdown', 'html']))
    .default(['json', 'markdown', 'html']),
});

function emptyCount(): CountSummary {
  return { found: 0, transferred: 0, skipped: 0, failed: 0 };
}

function fromStage(stage?: StageResult): CountSummary {
  if (!stage) return emptyCount();
  return {
    found: stage.itemsFound,
    transferred: stage.itemsTransferred,
    skipped: stage.itemsSkipped,
    failed: stage.itemsFailed,
    notes: stage.warnings,
  };
}

export class MigrationOrchestrator {
  private ui: ProgressUI;
  private options: MigrationOptions;

  constructor(partial: Partial<MigrationOptions> = {}) {
    this.options = MigrationOptionsSchema.parse({ ...DEFAULT_MIGRATION_OPTIONS, ...partial });
    this.ui = new ProgressUI(false);
  }

  async run(): Promise<MigrationReport> {
    assertSupportedPlatform();
    await initLogger(this.options.verbose);
    await fs.ensureDir(PATHS.logs);
    await fs.ensureDir(PATHS.backups);
    await fs.ensureDir(PATHS.reports);

    const sourceId = resolveBrowserId(this.options.sourceBrowser);
    const targetId = resolveBrowserId(this.options.targetBrowser);

    if (sourceId === targetId && this.options.sourceProfile === this.options.targetProfile) {
      throw new Error('Source and target browser/profile are identical — nothing to migrate.');
    }

    const reportId = generateId();
    const startedAt = nowIso();
    const startMs = Date.now();
    const stages: StageResult[] = [];
    const failures: string[] = [];
    const warnings: string[] = [];
    const skippedItems: string[] = [];

    this.ui.heading(
      this.options.dryRun
        ? `${sourceId} → ${targetId} Dry Run`
        : `${sourceId} → ${targetId} Migration`,
    );
    this.ui.info(`chromium-migrate ${APP_VERSION} · Report ${reportId}`);

    this.ui.start('Discovering browsers…');
    const sourceBrowser = await discoverBrowser(sourceId);
    const targetBrowser = await discoverBrowser(targetId);

    if (!sourceBrowser.exists) {
      throw new Error(
        `${sourceBrowser.displayName} profile directory not found at ${sourceBrowser.rootPath}`,
      );
    }
    if (!targetBrowser.exists && !this.options.dryRun) {
      this.ui.warn(
        `${targetBrowser.displayName} profile root missing — will create ${targetBrowser.rootPath}`,
      );
      await fs.ensureDir(targetBrowser.rootPath);
    }

    this.ui.succeed(
      `Found ${sourceBrowser.displayName} (${sourceBrowser.profiles.length} profiles) → ${targetBrowser.displayName} (${targetBrowser.profiles.length} profiles)`,
    );

    for (const note of sourceBrowser.notes) warnings.push(`[source] ${note}`);
    for (const note of targetBrowser.notes) warnings.push(`[target] ${note}`);

    if (!supportsSecretReencryption()) {
      warnings.push(
        `Password/cookie re-encryption is not supported on ${process.platform}; encrypted blobs are copied as-is`,
      );
    }

    const source = await resolveProfile(sourceBrowser, this.options.sourceProfile);
    let target = targetBrowser.profiles.find((p) => p.name === this.options.targetProfile)
      ? await resolveProfile(targetBrowser, this.options.targetProfile)
      : await ensureTargetProfile(targetBrowser.rootPath, this.options.targetProfile);

    source.cookies = await resolveCookiesPath(source.path);
    target.cookies = await resolveCookiesPath(target.path);

    this.ui.table([
      ['From', `${sourceBrowser.displayName} / ${source.name}`],
      ['To', `${targetBrowser.displayName} / ${target.name}`],
      ['Source path', source.path],
      ['Target path', target.path],
      ['Mode', this.options.dryRun ? 'dry-run (no writes)' : 'migrate'],
    ]);

    if (!this.options.dryRun) {
      this.ui.start('Preflight checks…');
      const preflight = await ensureBrowsersClosed([sourceBrowser, targetBrowser], {
        terminate: this.options.terminateBrowsers,
        force: this.options.force,
        ui: this.ui,
      });
      if (!preflight.ok) throw new Error(preflight.message);
      this.ui.succeed(preflight.message);
    }

    this.ui.start('Resolving OS secret-storage keys…');
    const sourceKey = await getBrowserSafeStorageKey(sourceBrowser);
    if (!this.options.dryRun) {
      await ensureBrowserSafeStoragePassword(targetBrowser);
    }
    const targetKey = await getBrowserSafeStorageKey(targetBrowser);
    if (!sourceKey) warnings.push(`${sourceBrowser.displayName} Safe Storage key not resolved`);
    if (!targetKey) warnings.push(`${targetBrowser.displayName} Safe Storage key not resolved`);
    this.ui.succeed(
      `Keys: ${sourceBrowser.id}=${sourceKey ? 'ok' : 'missing'}, ${targetBrowser.id}=${targetKey ? 'ok' : 'missing'}`,
    );

    let backupPath: string | undefined;
    if (!this.options.dryRun && !this.options.skipBackup) {
      this.ui.start(`Creating ${targetBrowser.displayName} profile backup…`);
      if (await fs.pathExists(target.preferences)) {
        const backup = await createBackup(target, targetBrowser.displayName);
        backupPath = backup.path;
        this.ui.succeed(`Backup created: ${backup.id} (${formatBytes(backup.sizeBytes)})`);
      } else {
        this.ui.succeed('No existing target profile data — backup skipped');
        skippedItems.push('backup (empty target profile)');
      }
    }

    const ctx: MigratorContext = {
      source,
      target,
      sourceBrowser,
      targetBrowser,
      dryRun: this.options.dryRun,
      ui: this.ui,
      sourceSafeKey: sourceKey?.key,
      targetSafeKey: targetKey?.key,
    };

    for (const migrator of this.buildMigratorPipeline()) {
      try {
        const result = await migrator.run(ctx);
        stages.push(result);
        warnings.push(...result.warnings.map((w) => `[${result.stage}] ${w}`));
        if (result.status === 'failed' || result.status === 'partial') {
          failures.push(...result.errors.map((e) => `[${result.stage}] ${e}`));
          if (!this.options.continueOnError && result.status === 'failed') break;
        }
      } catch (err) {
        failures.push(`[${migrator.stage}] ${String(err)}`);
        stages.push({
          stage: migrator.stage,
          status: 'failed',
          startedAt: nowIso(),
          finishedAt: nowIso(),
          itemsFound: 0,
          itemsTransferred: 0,
          itemsSkipped: 0,
          itemsFailed: 1,
          warnings: [],
          errors: [String(err)],
        });
        if (!this.options.continueOnError) break;
      }
    }

    if (!this.options.dryRun) {
      this.ui.start('Verifying migration…');
      try {
        const verification = await verifyMigration(source, target);
        stages.push({
          stage: 'verification',
          status: verification.every((v) => v.match) ? 'success' : 'partial',
          startedAt: nowIso(),
          finishedAt: nowIso(),
          itemsFound: verification.length,
          itemsTransferred: verification.filter((v) => v.match).length,
          itemsSkipped: 0,
          itemsFailed: verification.filter((v) => !v.match).length,
          warnings: verification
            .filter((v) => !v.match)
            .map((v) => `${v.category}: delta ${v.delta}`),
          errors: [],
          details: { verification },
        });
        this.ui.succeed(
          `Verification: ${verification.filter((v) => v.match).length}/${verification.length} categories match`,
        );
      } catch (err) {
        warnings.push(`Verification error: ${String(err)}`);
        this.ui.warn(`Verification incomplete: ${String(err)}`);
      }
    }

    const summary = this.buildSummary(stages);
    const report: MigrationReport = {
      id: reportId,
      version: APP_VERSION,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - startMs,
      source: {
        browser: sourceBrowser.displayName,
        browserId: sourceBrowser.id,
        profile: source.name,
        path: source.path,
      },
      target: {
        browser: targetBrowser.displayName,
        browserId: targetBrowser.id,
        profile: target.name,
        path: target.path,
      },
      dryRun: this.options.dryRun,
      backupPath,
      stages,
      summary,
      failures,
      warnings,
      skippedItems,
    };

    this.ui.start('Writing reports…');
    const reportPaths = await generateReports(report, this.options.reportFormats);
    this.ui.succeed(`Reports: ${reportPaths.join(', ')}`);

    this.printFinalSummary(report);
    getLogger().info(`Migration finished: success=${summary.overall.success}`);
    return report;
  }

  async dryRunEstimate(): Promise<{ report: MigrationReport; estimate: DryRunEstimate }> {
    this.options = { ...this.options, dryRun: true };
    const report = await this.run();

    const itemsFound: Record<string, number> = {};
    const itemsTransferable: Record<string, number> = {};
    for (const stage of report.stages) {
      itemsFound[stage.stage] = stage.itemsFound;
      itemsTransferable[stage.stage] = stage.itemsTransferred;
    }

    const sourceSize = await getDirectorySize(report.source.path);
    const available = await getAvailableDiskBytes(report.target.path);

    const estimate: DryRunEstimate = {
      itemsFound,
      itemsTransferable,
      unsupported: [
        'Browser-specific UI (Arc Spaces, Vivaldi panels, Opera workspaces, …)',
        'Cloud sync / account session state',
        'Full credit-card PANs (tokenized/masked metadata only)',
        ...(supportsSecretReencryption()
          ? []
          : [`Password/cookie re-encryption on ${process.platform}`]),
      ],
      warnings: report.warnings,
      diskUsageBytes: sourceSize,
      estimatedDurationMs: estimateMigrationTimeMs(itemsFound),
      sourceSizeBytes: sourceSize,
      availableDiskBytes: available,
    };

    this.ui.heading('Dry-Run Estimate');
    this.ui.table([
      ['Source size', formatBytes(estimate.sourceSizeBytes)],
      ['Available disk', formatBytes(estimate.availableDiskBytes)],
      ['Est. duration', `${Math.round(estimate.estimatedDurationMs / 1000)}s`],
      ['Unsupported', String(estimate.unsupported.length)],
    ]);

    return { report, estimate };
  }

  private buildMigratorPipeline(): BaseMigrator[] {
    const o = this.options;
    const pipeline: BaseMigrator[] = [];
    if (o.includeBookmarks) pipeline.push(new BookmarksMigrator());
    if (o.includeHistory) pipeline.push(new HistoryMigrator());
    if (o.includeDownloads) pipeline.push(new DownloadsMigrator());
    if (o.includeFavicons) {
      pipeline.push(new FaviconsMigrator());
      pipeline.push(new TopSitesMigrator());
    }
    if (o.includeAutofill) pipeline.push(new AutofillMigrator());
    if (o.includePasswords) pipeline.push(new PasswordsMigrator());
    if (o.includeCookies) pipeline.push(new CookiesMigrator());
    if (o.includeExtensions) pipeline.push(new ExtensionsMigrator());
    if (o.includeSessions) pipeline.push(new SessionsMigrator());
    if (o.includePermissions) pipeline.push(new PermissionsMigrator());
    if (o.includePreferences) pipeline.push(new PreferencesMigrator());
    return pipeline;
  }

  private buildSummary(stages: StageResult[]): MigrationSummary {
    const by = (name: string) => stages.find((s) => s.stage === name);
    const succeeded = stages.filter((s) => s.status === 'success' || s.status === 'partial').length;
    const failed = stages.filter((s) => s.status === 'failed').length;
    const skipped = stages.filter((s) => s.status === 'skipped').length;

    return {
      bookmarks: fromStage(by('bookmarks')),
      passwords: fromStage(by('passwords')),
      cookies: fromStage(by('cookies')),
      history: fromStage(by('history')),
      downloads: fromStage(by('downloads')),
      extensions: fromStage(by('extensions')),
      autofill: fromStage(by('autofill')),
      permissions: fromStage(by('permissions')),
      preferences: fromStage(by('preferences')),
      sessions: fromStage(by('sessions')),
      favicons: fromStage(by('favicons')),
      overall: {
        success: failed === 0,
        stagesSucceeded: succeeded,
        stagesFailed: failed,
        stagesSkipped: skipped,
        totalItemsFound: stages.reduce((a, s) => a + s.itemsFound, 0),
        totalItemsTransferred: stages.reduce((a, s) => a + s.itemsTransferred, 0),
      },
    };
  }

  private printFinalSummary(report: MigrationReport): void {
    const s = report.summary.overall;
    this.ui.summaryBox('Migration Report', [
      `Status: ${s.success ? 'SUCCESS' : 'COMPLETED WITH FAILURES'}`,
      `${report.source.browserId} → ${report.target.browserId}`,
      `Duration: ${Math.round((report.durationMs ?? 0) / 1000)}s`,
      `Stages: ${s.stagesSucceeded} ok · ${s.stagesFailed} failed · ${s.stagesSkipped} skipped`,
      `Items: ${s.totalItemsTransferred}/${s.totalItemsFound} transferred`,
      `Bookmarks: ${report.summary.bookmarks.transferred}/${report.summary.bookmarks.found}`,
      `Passwords: ${report.summary.passwords.transferred}/${report.summary.passwords.found}`,
      `Cookies: ${report.summary.cookies.transferred}/${report.summary.cookies.found}`,
      `History: ${report.summary.history.transferred}/${report.summary.history.found}`,
      `Extensions: ${report.summary.extensions.transferred}/${report.summary.extensions.found}`,
      `Warnings: ${report.warnings.length}`,
      `Failures: ${report.failures.length}`,
    ]);
  }
}
