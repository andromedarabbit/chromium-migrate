/**
 * Public library API for programmatic use.
 */
export { MigrationOrchestrator, MigrationOptionsSchema } from './migration/orchestrator.js';
export {
  discoverBrowser,
  discoverAllBrowsers,
  discoverArc,
  discoverBrave,
  resolveProfile,
} from './browsers/discovery.js';
export {
  BROWSER_REGISTRY,
  getBrowserDefinition,
  listBrowserIds,
  resolveBrowserId,
} from './browsers/registry.js';
export { createBackup, restoreBackup, listBackups } from './services/backup.js';
export { verifyMigration } from './migration/verify.js';
export { generateReports } from './reports/generator.js';
export { buildProgram, runCli } from './cli.js';
export * from './types/index.js';
