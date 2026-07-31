import type { Command } from 'commander';
import chalk from 'chalk';
import {
  BROWSER_REGISTRY,
  getPlatform,
  listBrowserIds,
  resolveUserDataCandidates,
} from '../browsers/registry.js';

export function registerBrowsersCommand(program: Command): void {
  program
    .command('browsers')
    .description('List supported browsers and their expected profile paths')
    .action(() => {
      const platform = getPlatform();
      console.log(chalk.bold(`Supported browsers on ${platform}\n`));
      for (const id of listBrowserIds()) {
        const def = BROWSER_REGISTRY[id];
        const paths = resolveUserDataCandidates(def, platform);
        if (paths.length === 0) {
          console.log(`${chalk.dim(id.padEnd(14))} ${def.displayName} ${chalk.yellow('(not available on this OS)')}`);
          continue;
        }
        console.log(`${chalk.cyan(id.padEnd(14))} ${def.displayName}`);
        for (const p of paths) {
          console.log(chalk.dim(`               ${p}`));
        }
        if (def.notes?.length) {
          for (const n of def.notes) console.log(chalk.yellow(`               note: ${n}`));
        }
      }
      console.log();
    });
}
