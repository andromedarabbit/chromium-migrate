import type { Command } from 'commander';
import fs from 'fs-extra';
import { cleanOldBackups, deleteBackup, listBackups } from '../services/backup.js';
import { PATHS } from '../core/constants.js';
import { initLogger } from '../utils/logger.js';
import { ProgressUI } from '../utils/progress.js';
import { formatBytes, getDirectorySize } from '../utils/helpers.js';

export function registerCleanCommand(program: Command): void {
  program
    .command('clean')
    .description('Clean old backups, logs, and temporary files')
    .option('--keep-backups <n>', 'Number of recent backups to keep', '5')
    .option('--logs', 'Also delete log files', false)
    .option('--reports', 'Also delete report files', false)
    .option('--backup <id>', 'Delete a specific backup by ID')
    .option('--all-backups', 'Delete all backups', false)
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts) => {
      await initLogger(Boolean(opts.verbose));
      const ui = new ProgressUI();
      ui.heading('Clean');

      if (opts.backup) {
        await deleteBackup(opts.backup);
        ui.succeed(`Deleted backup ${opts.backup}`);
        return;
      }

      if (opts.allBackups) {
        const backups = await listBackups();
        for (const b of backups) await deleteBackup(b.id);
        ui.succeed(`Deleted ${backups.length} backup(s)`);
      } else {
        const keep = Number(opts.keepBackups) || 5;
        const removed = await cleanOldBackups(keep);
        ui.succeed(`Removed ${removed} old backup(s); kept ${keep}`);
      }

      if (opts.logs) {
        await fs.emptyDir(PATHS.logs);
        ui.succeed('Cleared logs/');
      }

      if (opts.reports) {
        await fs.emptyDir(PATHS.reports);
        ui.succeed('Cleared reports/');
      }

      const backupSize = await getDirectorySize(PATHS.backups);
      const logSize = await getDirectorySize(PATHS.logs);
      ui.info(`Remaining — backups: ${formatBytes(backupSize)}, logs: ${formatBytes(logSize)}`);
    });
}
