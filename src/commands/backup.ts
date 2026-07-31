import type { Command } from 'commander';
import chalk from 'chalk';
import { discoverBrowser, resolveProfile } from '../browsers/discovery.js';
import { listBrowserIds } from '../browsers/registry.js';
import { createBackup, listBackups } from '../services/backup.js';
import { formatBytes } from '../utils/helpers.js';
import { initLogger } from '../utils/logger.js';
import { ProgressUI } from '../utils/progress.js';
import { ensureBrowsersClosed } from '../browsers/process.js';

export function registerBackupCommand(program: Command): void {
  const cmd = program.command('backup').description('Backup a browser profile');

  cmd
    .command('create')
    .description('Create a timestamped backup of a browser profile')
    .requiredOption(
      '-b, --browser <browser>',
      `Browser to back up (${listBrowserIds().join('|')})`,
    )
    .option('--profile <profile>', 'Profile name', 'Default')
    .option('-y, --terminate', 'Terminate browser if running', false)
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts) => {
      await initLogger(Boolean(opts.verbose));
      const ui = new ProgressUI();
      ui.heading('Backup Profile');

      const browser = await discoverBrowser(opts.browser);
      if (!browser.exists) throw new Error(`${browser.displayName} profile root not found`);

      const preflight = await ensureBrowsersClosed([browser], {
        terminate: Boolean(opts.terminate),
        force: false,
        ui,
      });
      if (!preflight.ok) throw new Error(preflight.message);

      const profile = await resolveProfile(browser, opts.profile);
      ui.start(`Backing up ${browser.displayName} / ${profile.name}…`);
      const backup = await createBackup(profile, browser.displayName);
      ui.succeed(`Backup ${backup.id} created (${formatBytes(backup.sizeBytes)})`);
      console.log(chalk.dim(backup.path));
    });

  cmd
    .command('list')
    .description('List available backups')
    .action(async () => {
      const ui = new ProgressUI();
      ui.heading('Backups');
      const backups = await listBackups();
      if (backups.length === 0) {
        ui.info('No backups found');
        return;
      }
      for (const b of backups) {
        console.log(
          `${chalk.cyan(b.id)}  ${b.manifest.sourceBrowser} / ${b.profileName}  ${formatBytes(b.sizeBytes)}  ${b.timestamp}`,
        );
      }
    });

  cmd.action(async () => {
    const backups = await listBackups();
    const ui = new ProgressUI();
    ui.heading('Backups');
    if (backups.length === 0) {
      ui.info('No backups found. Use: chromium-migrate backup create -b <browser>');
      return;
    }
    for (const b of backups) {
      console.log(
        `${chalk.cyan(b.id)}  ${b.manifest.sourceBrowser} / ${b.profileName}  ${formatBytes(b.sizeBytes)}  ${b.timestamp}`,
      );
    }
  });
}
