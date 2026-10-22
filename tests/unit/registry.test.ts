import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  resolveBrowserId,
  getBrowserDefinition,
  expandPath,
  listBrowserIds,
} from '../../src/browsers/registry.js';

describe('browser registry', () => {
  it('resolves aliases', () => {
    expect(resolveBrowserId('brave-browser')).toBe('brave');
    expect(resolveBrowserId('google-chrome')).toBe('chrome');
    expect(resolveBrowserId('msedge')).toBe('edge');
  });

  it('lists known browsers', () => {
    const ids = listBrowserIds();
    expect(ids).toContain('chrome');
    expect(ids).toContain('brave');
    expect(ids).toContain('arc');
    expect(ids).toContain('edge');
    expect(ids).toContain('ego-lite');
  });

  it('expands home path templates without hardcoding a user', () => {
    const def = getBrowserDefinition('chrome');
    const paths = def.userDataPaths.darwin ?? [];
    expect(paths[0]).toContain('{home}');
    const expanded = expandPath(paths[0]!);
    expect(expanded).not.toContain('{home}');
    expect(expanded.endsWith('Google/Chrome') || expanded.includes('Google/Chrome')).toBe(true);
  });

  it('rejects unknown browsers', () => {
    expect(() => resolveBrowserId('netscape')).toThrow(/Unknown browser/);
  });

  it('ego lite user-data root lives under the Citro Labs namespace', () => {
    const def = getBrowserDefinition('ego-lite');
    const [template] = def.userDataPaths.darwin ?? [];
    expect(template).toContain('{home}');
    expect(template).toContain(path.join('Application Support', 'Citro Labs', 'ego lite'));
    expect(def.safeStorage.darwin?.service).toBe('ego safe storage');
  });
});
