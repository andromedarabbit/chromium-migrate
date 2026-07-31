import type { Command } from 'commander';
import { MigrationOrchestrator } from '../migration/orchestrator.js';
import { listBrowserIds } from '../browsers/registry.js';

function sharedOptions(cmd: Command): Command {
  return cmd
    .requiredOption(
      '-f, --from <browser>',
      `Source browser (${listBrowserIds().join('|')})`,
    )
    .requiredOption(
      '-t, --to <browser>',
      `Target browser (${listBrowserIds().join('|')})`,
    )
    .option('--source-profile <profile>', 'Source profile name', 'Default')
    .option('--target-profile <profile>', 'Target profile name', 'Default')
    .option('--no-passwords', 'Skip password migration')
    .option('--no-cookies', 'Skip cookie migration')
    .option('--no-extensions', 'Skip extension migration')
    .option('--no-history', 'Skip history migration')
    .option('--no-bookmarks', 'Skip bookmark migration')
    .option('--no-autofill', 'Skip autofill migration')
    .option('--no-sessions', 'Skip session migration')
    .option('--no-permissions', 'Skip permissions migration')
    .option('--no-preferences', 'Skip preferences migration')
    .option('--no-downloads', 'Skip downloads migration')
    .option('--no-favicons', 'Skip favicons migration')
    .option('--skip-backup', 'Skip pre-migration backup', false)
    .option('-y, --terminate', 'Terminate running browsers without prompting', false)
    .option('--force', 'Force operations (implies --terminate)', false)
    .option('--no-continue-on-error', 'Abort on first stage failure')
    .option('-v, --verbose', 'Verbose logging', false);
}

export function registerMigrateCommand(program: Command): void {
  sharedOptions(
    program.command('migrate').description('Migrate a Chromium profile from one browser to another'),
  ).action(async (opts) => {
    const orchestrator = new MigrationOrchestrator({
      sourceBrowser: opts.from,
      targetBrowser: opts.to,
      sourceProfile: opts.sourceProfile,
      targetProfile: opts.targetProfile,
      dryRun: false,
      skipBackup: Boolean(opts.skipBackup),
      force: Boolean(opts.force),
      includePasswords: opts.passwords !== false,
      includeCookies: opts.cookies !== false,
      includeExtensions: opts.extensions !== false,
      includeHistory: opts.history !== false,
      includeBookmarks: opts.bookmarks !== false,
      includeAutofill: opts.autofill !== false,
      includeSessions: opts.sessions !== false,
      includePermissions: opts.permissions !== false,
      includePreferences: opts.preferences !== false,
      includeDownloads: opts.downloads !== false,
      includeFavicons: opts.favicons !== false,
      terminateBrowsers: Boolean(opts.terminate) || Boolean(opts.force),
      continueOnError: opts.continueOnError !== false,
      verbose: Boolean(opts.verbose),
    });

    const report = await orchestrator.run();
    if (!report.summary.overall.success) {
      process.exitCode = 2;
    }
  });
}
