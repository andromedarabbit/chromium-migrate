import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  encryptChromiumValue,
  decryptChromiumValue,
  reencryptValue,
} from '../../src/services/crypto.js';

function deriveTestKey(password: string): Buffer {
  return crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), 'saltysalt', 1003, 16, 'sha1');
}

describe('crypto', () => {
  it('encrypts and decrypts round-trip', () => {
    const key = deriveTestKey('test-password');
    const plain = Buffer.from('my-secret-password', 'utf8');
    const enc = encryptChromiumValue(plain, key);
    expect(enc.subarray(0, 3).toString()).toBe('v10');
    const dec = decryptChromiumValue(enc, key);
    expect(dec).not.toBeNull();
    expect(dec!.toString('utf8')).toBe('my-secret-password');
  });

  it('reencrypts between keys', () => {
    const src = deriveTestKey('arc-key');
    const dst = deriveTestKey('brave-key');
    const enc = encryptChromiumValue(Buffer.from('hunter2', 'utf8'), src);
    const re = reencryptValue(enc, src, dst);
    expect(re).not.toBeNull();
    const dec = decryptChromiumValue(re!, dst);
    expect(dec!.toString('utf8')).toBe('hunter2');
  });

  it('returns null for corrupt ciphertext', () => {
    const key = deriveTestKey('x');
    const junk = Buffer.from('v10not-valid-aes!!');
    expect(decryptChromiumValue(junk, key)).toBeNull();
  });
});
