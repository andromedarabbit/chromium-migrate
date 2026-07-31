import type { Command } from 'commander';
import chalk from 'chalk';
import { discoverBrowser, resolveProfile } from '../browsers/discovery.js';
import { listBrowserIds } from '../browsers/registry.js';
import { verifyMigration } from '../migration/verify.js';
import { ProgressUI } from '../utils/progress.js';
import { initLogger } from '../utils/logger.js';

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Verify counts between source and target profiles')
    .requiredOption('-f, --from <browser>', `Source browser (${listBrowserIds().join('|')})`)
    .requiredOption('-t, --to <browser>', `Target browser (${listBrowserIds().join('|')})`)
    .option('--source-profile <profile>', 'Source profile', 'Default')
    .option('--target-profile <profile>', 'Target profile', 'Default')
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts) => {
      await initLogger(Boolean(opts.verbose));
      const ui = new ProgressUI();
      ui.heading('Verify Migration');

      const sourceBrowser = await discoverBrowser(opts.from);
      const targetBrowser = await discoverBrowser(opts.to);
      if (!sourceBrowser.exists) throw new Error(`${sourceBrowser.displayName} not found`);
      if (!targetBrowser.exists) throw new Error(`${targetBrowser.displayName} not found`);

      const source = await resolveProfile(sourceBrowser, opts.sourceProfile);
      const target = await resolveProfile(targetBrowser, opts.targetProfile);
      const results = await verifyMigration(source, target);

      console.log();
      console.log(
        `${'Category'.padEnd(14)} ${'Source'.padStart(8)} ${'Target'.padStart(8)} ${'Match'.padStart(8)}`,
      );
      console.log(chalk.dim('─'.repeat(42)));
      let allMatch = true;
      for (const r of results) {
        const match = r.match ? chalk.green('yes') : chalk.red('no');
        if (!r.match) allMatch = false;
        console.log(
          `${r.category.padEnd(14)} ${String(r.sourceCount).padStart(8)} ${String(r.targetCount).padStart(8)} ${match.padStart(8)}`,
        );
      }
      console.log();
      if (allMatch) ui.succeed('All categories match');
      else {
        ui.fail('Some categories differ');
        process.exitCode = 2;
      }
    });
}
