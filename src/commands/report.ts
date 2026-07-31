import type { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { listReports } from '../reports/generator.js';
import { PATHS } from '../core/constants.js';
import { ProgressUI } from '../utils/progress.js';

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('List or show migration reports')
    .argument('[file]', 'Specific report file name to display')
    .option('--open', 'Print absolute path for the latest HTML report', false)
    .action(async (file: string | undefined, opts) => {
      const ui = new ProgressUI();
      ui.heading('Reports');
      await fs.ensureDir(PATHS.reports);
      const files = await listReports();

      if (files.length === 0) {
        ui.info('No reports yet. Run migrate or dry-run first.');
        return;
      }

      if (!file) {
        for (const f of files.slice(0, 20)) {
          console.log(`  ${chalk.cyan(f)}`);
        }
        if (opts.open) {
          const html = files.find((f) => f.endsWith('.html'));
          if (html) console.log(path.join(PATHS.reports, html));
        }
        return;
      }

      const full = path.isAbsolute(file) ? file : path.join(PATHS.reports, file);
      if (!(await fs.pathExists(full))) {
        throw new Error(`Report not found: ${full}`);
      }
      if (full.endsWith('.json')) {
        const data = await fs.readJson(full);
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(await fs.readFile(full, 'utf8'));
      }
    });
}
