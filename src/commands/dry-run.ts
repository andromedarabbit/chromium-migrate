import type { Command } from 'commander';
import chalk from 'chalk';
import { MigrationOrchestrator } from '../migration/orchestrator.js';
import { listBrowserIds } from '../browsers/registry.js';
import { formatBytes, formatDuration } from '../utils/helpers.js';

export function registerDryRunCommand(program: Command): void {
  program
    .command('dry-run')
    .description('Estimate migration without writing any data')
    .requiredOption('-f, --from <browser>', `Source browser (${listBrowserIds().join('|')})`)
    .requiredOption('-t, --to <browser>', `Target browser (${listBrowserIds().join('|')})`)
    .option('--source-profile <profile>', 'Source profile', 'Default')
    .option('--target-profile <profile>', 'Target profile', 'Default')
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts) => {
      const orchestrator = new MigrationOrchestrator({
        sourceBrowser: opts.from,
        targetBrowser: opts.to,
        sourceProfile: opts.sourceProfile,
        targetProfile: opts.targetProfile,
        dryRun: true,
        verbose: Boolean(opts.verbose),
        terminateBrowsers: false,
      });

      const { estimate } = await orchestrator.dryRunEstimate();

      console.log();
      console.log(chalk.bold('Items found'));
      for (const [k, v] of Object.entries(estimate.itemsFound)) {
        console.log(`  ${k.padEnd(16)} ${v}`);
      }
      console.log();
      console.log(chalk.bold('Unsupported'));
      for (const u of estimate.unsupported) {
        console.log(chalk.yellow(`  • ${u}`));
      }
      console.log();
      console.log(
        chalk.bold('Disk:'),
        formatBytes(estimate.sourceSizeBytes),
        'source ·',
        formatBytes(estimate.availableDiskBytes),
        'available · est.',
        formatDuration(estimate.estimatedDurationMs),
      );
    });
}
