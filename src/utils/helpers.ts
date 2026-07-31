import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { CHROME_EPOCH_OFFSET_MS } from '../core/constants.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function timestampDir(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('-');
}

export function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Convert Chromium microseconds-since-1601 to JS Date */
export function chromeTimeToDate(chromeTime: number): Date {
  if (!chromeTime || chromeTime <= 0) return new Date(0);
  return new Date(chromeTime / 1000 - CHROME_EPOCH_OFFSET_MS);
}

/** Convert JS Date / ms epoch to Chromium microseconds-since-1601 */
export function dateToChromeTime(date: Date | number): number {
  const ms = typeof date === 'number' ? date : date.getTime();
  return Math.round((ms + CHROME_EPOCH_OFFSET_MS) * 1000);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rem}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export async function getDirectorySize(dir: string): Promise<number> {
  if (!(await fs.pathExists(dir))) return 0;
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(full);
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      total += stat.size;
    }
  }
  return total;
}

export async function getAvailableDiskBytes(targetPath: string): Promise<number> {
  try {
    const { execa } = await import('execa');
    const { stdout } = await execa('df', ['-k', targetPath]);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return 0;
    const parts = lines[1]!.split(/\s+/);
    const availKb = Number(parts[3] ?? 0);
    return availKb * 1024;
  } catch {
    return 0;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function copyIfExists(src: string, dest: string): Promise<boolean> {
  if (!(await fs.pathExists(src))) return false;
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest, { overwrite: true, errorOnExist: false, dereference: true });
  return true;
}

export function redactSensitive(message: string): string {
  return message
    .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
    .replace(/cookie[=:]\s*\S+/gi, 'cookie=[REDACTED]')
    .replace(/encrypted_value[=:]\s*\S+/gi, 'encrypted_value=[REDACTED]')
    .replace(/password_value[=:]\s*\S+/gi, 'password_value=[REDACTED]');
}

export function estimateMigrationTimeMs(itemCounts: Record<string, number>): number {
  // Rough empirical estimates (ms per item)
  const rates: Record<string, number> = {
    bookmarks: 0.5,
    history: 0.2,
    cookies: 1.5,
    passwords: 3,
    downloads: 0.5,
    autofill: 0.8,
    extensions: 50,
    sessions: 5,
    permissions: 1,
    preferences: 10,
    favicons: 0.3,
  };
  let total = 2_000; // base overhead
  for (const [key, count] of Object.entries(itemCounts)) {
    total += (rates[key] ?? 1) * count;
  }
  return Math.round(total);
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function supportedPlatforms(): string[] {
  return ['darwin', 'linux', 'win32'];
}

export function assertSupportedPlatform(): void {
  if (!supportedPlatforms().includes(process.platform)) {
    throw new Error(
      `chromium-migrate does not support platform "${process.platform}". Supported: ${supportedPlatforms().join(', ')}`,
    );
  }
}

/** @deprecated Use assertSupportedPlatform */
export function assertMacOS(): void {
  assertSupportedPlatform();
}
