import crypto from 'node:crypto';
import keytar from 'keytar';
import { execa } from 'execa';
import {
  CHROMIUM_AES_IV,
  CRYPTO_PREFIX_V10,
  CRYPTO_PREFIX_V11,
  SECRET_REENCRYPT_PLATFORMS,
} from '../core/constants.js';
import type { CryptoKeyMaterial } from '../types/index.js';
import type { BrowserInfo } from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { getPlatform } from '../browsers/registry.js';

/**
 * Chromium on macOS stores an encryption password in the Keychain under
 * "<Browser> Safe Storage". The derived AES key is:
 *   PBKDF2(password, "saltysalt", 1003, 16, SHA-1)
 * Ciphertext blobs are prefixed with "v10" or "v11" and encrypted with AES-128-CBC.
 *
 * Linux uses the same AES scheme with a password from libsecret / gnome-keyring
 * (via keytar when available). Windows uses DPAPI — re-encryption is not yet supported.
 */

function deriveKey(password: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

async function getPasswordFromKeytar(service: string, account: string): Promise<Buffer | null> {
  try {
    const secret = await keytar.getPassword(service, account);
    if (secret) return Buffer.from(secret, 'utf8');
  } catch (err) {
    getLogger().debug(`keytar getPassword failed for ${service}: ${String(err)}`);
  }
  return null;
}

async function getPasswordViaSecurity(service: string, account: string): Promise<Buffer | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execa('security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ]);
    const password = stdout.trim();
    if (password) return Buffer.from(password, 'utf8');
  } catch (err) {
    getLogger().debug(`security find-generic-password failed for ${service}: ${String(err)}`);
  }
  return null;
}

export function supportsSecretReencryption(platform = getPlatform()): boolean {
  return SECRET_REENCRYPT_PLATFORMS.has(platform);
}

export async function resolveSafeStorageKey(
  service: string,
  account: string,
  fallbacks: readonly string[] = [],
): Promise<CryptoKeyMaterial | null> {
  if (!supportsSecretReencryption()) {
    getLogger().warn(
      `Secret re-encryption is not supported on ${process.platform}; encrypted blobs will be copied as-is`,
    );
    return null;
  }

  const candidates: Array<{ service: string; account: string }> = [
    { service, account },
    ...fallbacks.map((s) => ({ service: s, account })),
    { service, account: service.replace(/ Safe Storage$/, '') },
  ];

  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.service}::${c.account}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let password = await getPasswordFromKeytar(c.service, c.account);
    if (!password) password = await getPasswordViaSecurity(c.service, c.account);
    if (password) {
      getLogger().info(`Resolved Safe Storage key via service="${c.service}"`);
      return {
        service: c.service,
        account: c.account,
        key: deriveKey(password),
      };
    }
  }

  getLogger().warn(`Could not resolve Safe Storage key for ${service}`);
  return null;
}

export async function getBrowserSafeStorageKey(
  browser: BrowserInfo,
): Promise<CryptoKeyMaterial | null> {
  return resolveSafeStorageKey(
    browser.safeStorageService,
    browser.safeStorageAccount,
    browser.safeStorageFallbacks,
  );
}

function stripPrefix(blob: Buffer): { version: 'v10' | 'v11' | 'none'; data: Buffer } {
  if (blob.length >= 3 && blob.subarray(0, 3).equals(CRYPTO_PREFIX_V10)) {
    return { version: 'v10', data: blob.subarray(3) };
  }
  if (blob.length >= 3 && blob.subarray(0, 3).equals(CRYPTO_PREFIX_V11)) {
    return { version: 'v11', data: blob.subarray(3) };
  }
  return { version: 'none', data: blob };
}

export function decryptChromiumValue(encrypted: Buffer, key: Buffer): Buffer | null {
  if (!encrypted || encrypted.length === 0) return Buffer.alloc(0);
  try {
    const { data } = stripPrefix(encrypted);
    if (data.length === 0) return Buffer.alloc(0);
    if (data.length % 16 !== 0) return null;
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, CHROMIUM_AES_IV);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return null;
  }
}

export function encryptChromiumValue(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, CHROMIUM_AES_IV);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([CRYPTO_PREFIX_V10, encrypted]);
}

export function reencryptValue(
  encrypted: Buffer,
  sourceKey: Buffer,
  targetKey: Buffer,
): Buffer | null {
  const plain = decryptChromiumValue(encrypted, sourceKey);
  if (plain === null) return null;
  try {
    return encryptChromiumValue(plain, targetKey);
  } finally {
    plain.fill(0);
  }
}

/**
 * Ensure the target browser has a Safe Storage password in the OS keychain.
 * Generates one if missing (macOS/Linux via keytar).
 */
export async function ensureBrowserSafeStoragePassword(browser: BrowserInfo): Promise<string | null> {
  if (!supportsSecretReencryption()) return null;

  const existing = await keytar.getPassword(browser.safeStorageService, browser.safeStorageAccount);
  if (existing) return existing;

  for (const service of browser.safeStorageFallbacks) {
    const pw = await keytar.getPassword(service, browser.safeStorageAccount);
    if (pw) return pw;
  }

  const generated = crypto.randomBytes(16).toString('hex');
  try {
    await keytar.setPassword(browser.safeStorageService, browser.safeStorageAccount, generated);
    getLogger().info(`Created Safe Storage password for ${browser.displayName}`);
  } catch (err) {
    getLogger().warn(`Could not store Safe Storage password: ${String(err)}`);
  }
  return generated;
}

export function decryptToUtf8(encrypted: Buffer, key: Buffer): string | null {
  const buf = decryptChromiumValue(encrypted, key);
  if (buf === null) return null;
  try {
    return buf.toString('utf8');
  } finally {
    buf.fill(0);
  }
}
