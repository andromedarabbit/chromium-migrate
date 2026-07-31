import { describe, it, expect } from 'vitest';
import {
  chromeTimeToDate,
  dateToChromeTime,
  formatBytes,
  formatDuration,
  redactSensitive,
  estimateMigrationTimeMs,
  safeJsonParse,
} from '../../src/utils/helpers.js';

describe('helpers', () => {
  it('round-trips chrome time', () => {
    const now = Date.now();
    const chrome = dateToChromeTime(now);
    const back = chromeTimeToDate(chrome).getTime();
    expect(Math.abs(back - now)).toBeLessThan(2);
  });

  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('formats duration', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(2500)).toBe('2s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('redacts secrets', () => {
    const s = redactSensitive('password=supersecret cookie=abc encrypted_value=xyz');
    expect(s).not.toContain('supersecret');
    expect(s).toContain('[REDACTED]');
  });

  it('estimates migration time', () => {
    const ms = estimateMigrationTimeMs({ history: 10000, cookies: 1000, passwords: 100 });
    expect(ms).toBeGreaterThan(2000);
  });

  it('safeJsonParse falls back', () => {
    expect(safeJsonParse('not-json', { a: 1 })).toEqual({ a: 1 });
    expect(safeJsonParse('{"b":2}', { a: 1 })).toEqual({ b: 2 });
  });
});
