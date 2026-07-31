import fs from 'fs-extra';
import path from 'node:path';
import { PATHS } from '../core/constants.js';
import type { BackupInfo, BackupManifest, ProfilePaths } from '../types/index.js';
import {
  copyIfExists,
  getDirectorySize,
  nowIso,
  sha256File,
  timestampDir,
} from '../utils/helpers.js';
import { getLogger } from '../utils/logger.js';

const PROFILE_ITEMS = [
  'Bookmarks',
  'Bookmarks.bak',
  'History',
  'History-journal',
  'Cookies',
  'Login Data',
  'Login Data For Account',
  'Web Data',
  'Favicons',
  'Top Sites',
  'Preferences',
  'Secure Preferences',
  'Current Session',
  'Current Tabs',
  'Last Session',
  'Last Tabs',
  'Sessions',
  'Extensions',
  'Extension State',
  'Extension Rules',
  'Extension Scripts',
  'Local Extension Settings',
  'Sync Extension Settings',
  'Managed Extension Settings',
  'Network',
  'Network Persistent State',
  'Shortcuts',
  'Visited Links',
  'TransportSecurity',
  'Site Characteristics Database',
  'shared_proto_db',
  'Service Worker',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'File System',
] as const;

export async function createBackup(
  profile: ProfilePaths,
  sourceBrowser = 'Brave',
): Promise<BackupInfo> {
  const id = timestampDir();
  const backupPath = path.join(PATHS.backups, id);
  await fs.ensureDir(backupPath);

  const logger = getLogger();
  logger.info(`Creating backup at ${backupPath}`);

  const files: string[] = [];
  const checksums: Record<string, string> = {};

  for (const item of PROFILE_ITEMS) {
    const src = path.join(profile.path, item);
    if (!(await fs.pathExists(src))) continue;
    const dest = path.join(backupPath, 'profile', item);
    await fs.copy(src, dest, { overwrite: true, dereference: true });
    files.push(item);

    const stat = await fs.stat(src);
    if (stat.isFile()) {
      checksums[item] = await sha256File(src);
    }
  }

  // Also back up Local State snippet for profile metadata (read-only copy)
  const localState = path.join(path.dirname(profile.path), 'Local State');
  if (await fs.pathExists(localState)) {
    await copyIfExists(localState, path.join(backupPath, 'Local State'));
    files.push('Local State');
  }

  const manifest: BackupManifest = {
    version: '1.0.0',
    createdAt: nowIso(),
    sourceBrowser,
    profileName: profile.name,
    profilePath: profile.path,
    files,
    checksums,
  };

  await fs.writeJson(path.join(backupPath, 'manifest.json'), manifest, { spaces: 2 });

  const sizeBytes = await getDirectorySize(backupPath);
  logger.info(`Backup complete: ${files.length} items, ${sizeBytes} bytes`);

  return {
    id,
    timestamp: manifest.createdAt,
    path: backupPath,
    profileName: profile.name,
    profilePath: profile.path,
    sizeBytes,
    manifest,
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  await fs.ensureDir(PATHS.backups);
  const entries = await fs.readdir(PATHS.backups, { withFileTypes: true });
  const backups: BackupInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(PATHS.backups, entry.name, 'manifest.json');
    if (!(await fs.pathExists(manifestPath))) continue;
    try {
      const manifest = (await fs.readJson(manifestPath)) as BackupManifest;
      const backupPath = path.join(PATHS.backups, entry.name);
      backups.push({
        id: entry.name,
        timestamp: manifest.createdAt,
        path: backupPath,
        profileName: manifest.profileName,
        profilePath: manifest.profilePath,
        sizeBytes: await getDirectorySize(backupPath),
        manifest,
      });
    } catch {
      /* skip corrupt */
    }
  }

  backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return backups;
}

export async function restoreBackup(
  backupId?: string,
  targetProfilePath?: string,
): Promise<{ ok: boolean; message: string; backup: BackupInfo }> {
  const backups = await listBackups();
  if (backups.length === 0) {
    throw new Error('No backups found. Nothing to restore.');
  }

  const backup = backupId ? backups.find((b) => b.id === backupId) : backups[0];
  if (!backup) {
    throw new Error(`Backup not found: ${backupId}. Available: ${backups.map((b) => b.id).join(', ')}`);
  }

  const destProfile = targetProfilePath ?? backup.manifest.profilePath;
  const logger = getLogger();
  logger.info(`Restoring backup ${backup.id} → ${destProfile}`);

  await fs.ensureDir(destProfile);
  const profileBackup = path.join(backup.path, 'profile');

  if (!(await fs.pathExists(profileBackup))) {
    throw new Error(`Backup profile data missing at ${profileBackup}`);
  }

  // Clear existing critical files then restore
  for (const item of backup.manifest.files) {
    if (item === 'Local State') continue;
    const src = path.join(profileBackup, item);
    if (!(await fs.pathExists(src))) continue;
    const dest = path.join(destProfile, item);
    await fs.remove(dest).catch(() => undefined);
    await fs.copy(src, dest, { overwrite: true, dereference: true });
  }

  // Verify checksums for files
  let verified = 0;
  let mismatches = 0;
  for (const [file, expected] of Object.entries(backup.manifest.checksums)) {
    const restored = path.join(destProfile, file);
    if (!(await fs.pathExists(restored))) {
      mismatches++;
      continue;
    }
    const stat = await fs.stat(restored);
    if (!stat.isFile()) continue;
    const actual = await sha256File(restored);
    if (actual === expected) verified++;
    else mismatches++;
  }

  const ok = mismatches === 0;
  const message = ok
    ? `Restored backup ${backup.id} successfully (${verified} files verified).`
    : `Restored backup ${backup.id} with ${mismatches} checksum mismatch(es).`;

  logger.info(message);
  return { ok, message, backup };
}

export async function deleteBackup(backupId: string): Promise<void> {
  const backupPath = path.join(PATHS.backups, backupId);
  if (!(await fs.pathExists(backupPath))) {
    throw new Error(`Backup not found: ${backupId}`);
  }
  await fs.remove(backupPath);
  getLogger().info(`Deleted backup ${backupId}`);
}

export async function cleanOldBackups(keep = 5): Promise<number> {
  const backups = await listBackups();
  if (backups.length <= keep) return 0;
  const toDelete = backups.slice(keep);
  for (const b of toDelete) {
    await fs.remove(b.path);
  }
  return toDelete.length;
}
