import path from 'node:path';
import { getProjectRoot } from './paths.js';

export const PATHS = {
  get logs(): string {
    return path.join(getProjectRoot(), 'logs');
  },
  get backups(): string {
    return path.join(getProjectRoot(), 'backups');
  },
  get reports(): string {
    return path.join(getProjectRoot(), 'reports');
  },
} as const;

/** Chromium chrome time epoch offset: microseconds since 1601-01-01 */
export const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000;

/** Default AES-CBC IV used by Chromium on macOS/Linux for cookie/password encryption */
export const CHROMIUM_AES_IV = Buffer.from(' '.repeat(16));

/** Encrypted blob version prefix */
export const CRYPTO_PREFIX_V10 = Buffer.from('v10');
export const CRYPTO_PREFIX_V11 = Buffer.from('v11');

export const BATCH_SIZE = {
  history: 5_000,
  cookies: 2_000,
  passwords: 500,
  autofill: 1_000,
  downloads: 500,
} as const;

export const SQLITE_BUSY_TIMEOUT_MS = 10_000;

/** Platforms where Keychain/libsecret AES-CBC re-encryption is implemented */
export const SECRET_REENCRYPT_PLATFORMS = new Set(['darwin']);
