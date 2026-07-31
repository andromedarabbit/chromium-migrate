import type { Command } from 'commander';
import { restoreBackup, listBackups } from '../services/backup.js';
import { ensureBrowsersClosed } from '../browsers/process.js';
import { discoverBrowser } from '../browsers/discovery.js';
import { initLogger } from '../utils/logger.js';
import { ProgressUI } from '../utils/progress.js';

export function registerRollbackCommand(program: Command): void {
  program
    .command('rollback')
    .description('Restore a profile from a previous backup')
    .argument('[backupId]', 'Backup ID (defaults to most recent)')
    .option('--profile-path <path>', 'Override restore destination profile path')
    .option('-b, --browser <browser>', 'Browser to terminate before restore')
    .option('-y, --terminate', 'Terminate browser if running', false)
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (backupId: string | undefined, opts) => {
      await initLogger(Boolean(opts.verbose));
      const ui = new ProgressUI();
      ui.heading('Rollback');

      const backups = await listBackups();
      if (backups.length === 0) throw new Error('No backups available');

      if (opts.browser) {
        const browser = await discoverBrowser(opts.browser);
        const preflight = await ensureBrowsersClosed([browser], {
          terminate: Boolean(opts.terminate),
          force: false,
          ui,
        });
        if (!preflight.ok) throw new Error(preflight.message);
      }

      ui.start(`Restoring ${backupId ?? backups[0]!.id}…`);
      const result = await restoreBackup(backupId, opts.profilePath);
      if (result.ok) ui.succeed(result.message);
      else {
        ui.warn(result.message);
        process.exitCode = 2;
      }
    });
}
