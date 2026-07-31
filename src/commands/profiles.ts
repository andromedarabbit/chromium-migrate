import type { Command } from 'commander';
import chalk from 'chalk';
import { discoverAllBrowsers, discoverBrowser } from '../browsers/discovery.js';
import { listBrowserIds } from '../browsers/registry.js';
import { formatBytes } from '../utils/helpers.js';
import { ProgressUI } from '../utils/progress.js';
import { initLogger } from '../utils/logger.js';

export function registerProfilesCommand(program: Command): void {
  program
    .command('profiles')
    .description('List discovered browser profiles on this machine')
    .option(
      '-b, --browser <browser>',
      `Limit to one browser (${listBrowserIds().join('|')})`,
    )
    .option('-v, --verbose', 'Verbose logging', false)
    .action(async (opts) => {
      await initLogger(Boolean(opts.verbose));
      const ui = new ProgressUI();
      ui.heading('Browser Profiles');
      ui.start('Scanning…');

      const browsers = opts.browser
        ? [await discoverBrowser(opts.browser)]
        : await discoverAllBrowsers();

      ui.succeed(`Scan complete (${browsers.length} browser(s) with data)`);

      if (browsers.length === 0) {
        ui.info('No Chromium browser profiles found.');
        return;
      }

      for (const browser of browsers) {
        console.log(chalk.bold.magenta(`\n${browser.displayName}`), chalk.dim(`(${browser.id})`));
        console.log(chalk.dim(browser.rootPath));
        if (browser.version) console.log(chalk.dim(`  version ${browser.version}`));
        if (browser.profiles.length === 0) {
          console.log(chalk.yellow('  No profiles discovered'));
          continue;
        }
        for (const p of browser.profiles) {
          const tag = p.isDefault ? chalk.green(' [default]') : '';
          console.log(`  ${chalk.cyan(p.name)}${tag}`);
          console.log(
            chalk.dim(
              `    bookmarks=${p.bookmarkCount ?? '?'} history=${p.historyCount ?? '?'} passwords=${p.passwordCount ?? '?'} cookies=${p.cookieCount ?? '?'} extensions=${p.extensionCount ?? '?'} size=${p.sizeBytes !== undefined ? formatBytes(p.sizeBytes) : '?'}`,
            ),
          );
        }
      }
      console.log();
    });
}
