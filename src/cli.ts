#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { APP_NAME, APP_VERSION } from './types/index.js';
import { listBrowserIds } from './browsers/registry.js';
import { registerMigrateCommand } from './commands/migrate.js';
import { registerVerifyCommand } from './commands/verify.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerRollbackCommand } from './commands/rollback.js';
import { registerDryRunCommand } from './commands/dry-run.js';
import { registerReportCommand } from './commands/report.js';
import { registerProfilesCommand } from './commands/profiles.js';
import { registerCleanCommand } from './commands/clean.js';
import { registerBrowsersCommand } from './commands/browsers.js';
import { assertSupportedPlatform } from './utils/helpers.js';
import { brandDescription, helpFooter, printSplash } from './utils/brand.js';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name(APP_NAME)
    .description(brandDescription())
    .version(APP_VERSION)
    .addHelpText('beforeAll', () => {
      printSplash();
      return '';
    })
    .addHelpText('after', helpFooter(listBrowserIds().join(', ')))
    .hook('preAction', () => {
      assertSupportedPlatform();
    });

  registerMigrateCommand(program);
  registerVerifyCommand(program);
  registerBackupCommand(program);
  registerRollbackCommand(program);
  registerDryRunCommand(program);
  registerReportCommand(program);
  registerProfilesCommand(program);
  registerBrowsersCommand(program);
  registerCleanCommand(program);

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();
  // Bare invocation → help with splash
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  await program.parseAsync(argv);
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return /cli\.(js|ts)$/.test(entry) || /chromium-migrate|arc2brave|cmigrate/.test(entry);
  }
}

if (isExecutedDirectly()) {
  runCli().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nFatal: ${message}`);
    if (err instanceof Error && err.stack && process.env.CHROMIUM_MIGRATE_DEBUG) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  });
}
