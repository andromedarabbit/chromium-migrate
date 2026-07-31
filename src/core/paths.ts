import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve project root for logs/backups/reports.
 * Prefers walking up from this module (installed package), then cwd.
 */
export function getProjectRoot(): string {
  const envRoot = process.env.CHROMIUM_MIGRATE_HOME;
  if (envRoot) return envRoot;

  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through */
  }

  return process.cwd();
}
