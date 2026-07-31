import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { createEmptyBraveProfile } from '../fixtures/mock-profiles.js';

vi.mock('../../src/core/constants.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/constants.js')>(
    '../../src/core/constants.js',
  );
  const tmpBackups = path.join(os.tmpdir(), `arc2brave-backups-${process.pid}`);
  return {
    ...actual,
    PATHS: {
      get logs() {
        return path.join(tmpBackups, 'logs');
      },
      get backups() {
        return path.join(tmpBackups, 'backups');
      },
      get reports() {
        return path.join(tmpBackups, 'reports');
      },
    },
  };
});

describe('backup and rollback', () => {
  let tmp: string;
  let backupsRoot: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arc2brave-bak-'));
    backupsRoot = path.join(os.tmpdir(), `arc2brave-backups-${process.pid}`);
    await fs.ensureDir(path.join(backupsRoot, 'backups'));
  });

  afterEach(async () => {
    await fs.remove(tmp);
    await fs.remove(backupsRoot);
    vi.resetModules();
  });

  it('creates backup and restores profile files', async () => {
    const { createBackup, restoreBackup, listBackups } = await import(
      '../../src/services/backup.js'
    );
    const brave = await createEmptyBraveProfile(tmp);
    await fs.writeFile(path.join(brave.profile.path, 'Bookmarks'), '{"roots":{}}');
    await fs.writeFile(path.join(brave.profile.path, 'History'), 'sqlite-placeholder');

    const backup = await createBackup(brave.profile, 'Brave');
    expect(backup.id).toBeTruthy();
    expect(await fs.pathExists(path.join(backup.path, 'manifest.json'))).toBe(true);

    // Corrupt profile
    await fs.writeFile(path.join(brave.profile.path, 'Bookmarks'), 'CORRUPTED');

    const result = await restoreBackup(backup.id);
    expect(result.ok).toBe(true);
    const restored = await fs.readFile(path.join(brave.profile.path, 'Bookmarks'), 'utf8');
    expect(restored).toBe('{"roots":{}}');

    const listed = await listBackups();
    expect(listed.some((b) => b.id === backup.id)).toBe(true);
  });
});
