import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { BookmarksMigrator } from '../../src/migration/bookmarks.js';
import { HistoryMigrator } from '../../src/migration/history.js';
import { PasswordsMigrator } from '../../src/migration/passwords.js';
import { CookiesMigrator } from '../../src/migration/cookies.js';
import { AutofillMigrator } from '../../src/migration/autofill.js';
import { ExtensionsMigrator } from '../../src/migration/extensions.js';
import { FaviconsMigrator } from '../../src/migration/favicons.js';
import { PreferencesMigrator } from '../../src/migration/preferences.js';
import { PermissionsMigrator } from '../../src/migration/permissions.js';
import { SessionsMigrator } from '../../src/migration/sessions.js';
import { ProgressUI } from '../../src/utils/progress.js';
import { resolveCookiesPath } from '../../src/browsers/discovery.js';
import { verifyMigration } from '../../src/migration/verify.js';
import {
  createMockArcProfile,
  createEmptyBraveProfile,
} from '../fixtures/mock-profiles.js';
import { decryptChromiumValue } from '../../src/services/crypto.js';
import { openReadonlyCopy, tableExists, countRows } from '../../src/database/sqlite.js';
import type { BrowserInfo } from '../../src/types/index.js';
import type { MigratorContext } from '../../src/migration/base.js';

function fakeBrowser(
  id: 'arc' | 'brave',
  displayName: string,
  enrichments: BrowserInfo['enrichments'] = [],
): BrowserInfo {
  return {
    id,
    name: displayName,
    displayName,
    rootPath: '/tmp',
    exists: true,
    profiles: [],
    processNames: [],
    bundleIds: [],
    safeStorageService: `${displayName} Safe Storage`,
    safeStorageAccount: displayName,
    safeStorageFallbacks: [],
    enrichments,
    notes: [],
    platform: process.platform,
  };
}

describe('integration migration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cmigrate-int-'));
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it('migrates all major data categories', async () => {
    const arc = await createMockArcProfile(tmp);
    const brave = await createEmptyBraveProfile(tmp);
    arc.profile.cookies = await resolveCookiesPath(arc.profile.path);
    brave.profile.cookies = path.join(brave.profile.path, 'Network', 'Cookies');

    const ui = new ProgressUI(true);
    const ctx: MigratorContext = {
      source: arc.profile,
      target: brave.profile,
      sourceBrowser: fakeBrowser('arc', 'Arc', ['arc-sidebar']),
      targetBrowser: fakeBrowser('brave', 'Brave'),
      dryRun: false,
      ui,
      sourceSafeKey: arc.key,
      targetSafeKey: brave.key,
    };

    const results = await Promise.all([
      new BookmarksMigrator().run(ctx),
      new HistoryMigrator().run(ctx),
      new PasswordsMigrator().run(ctx),
      new CookiesMigrator().run(ctx),
      new AutofillMigrator().run(ctx),
      new ExtensionsMigrator().run(ctx),
      new FaviconsMigrator().run(ctx),
      new PreferencesMigrator().run(ctx),
      new PermissionsMigrator().run(ctx),
      new SessionsMigrator().run(ctx),
    ]);

    for (const r of results) {
      expect(r.status === 'success' || r.status === 'partial').toBe(true);
      expect(r.itemsFailed).toBe(0);
    }

    brave.profile.cookies = await resolveCookiesPath(brave.profile.path);
    const verification = await verifyMigration(arc.profile, brave.profile);
    const bookmarks = verification.find((v) => v.category === 'bookmarks');
    expect(bookmarks?.match).toBe(true);
    expect(bookmarks?.targetCount).toBe(2);

    const history = verification.find((v) => v.category === 'history');
    expect(history?.match).toBe(true);

    const passwords = verification.find((v) => v.category === 'passwords');
    expect(passwords?.targetCount).toBe(1);

    const login = await openReadonlyCopy(brave.profile.loginData);
    try {
      const row = login.db.prepare('SELECT password_value FROM logins').get() as {
        password_value: Buffer;
      };
      const plain = decryptChromiumValue(row.password_value, brave.key);
      expect(plain?.toString('utf8')).toBe('s3cret');
    } finally {
      await login.close();
    }

    const cookies = await openReadonlyCopy(brave.profile.cookies);
    try {
      expect(tableExists(cookies.db, 'cookies')).toBe(true);
      expect(countRows(cookies.db, 'cookies')).toBe(1);
      const row = cookies.db.prepare('SELECT encrypted_value FROM cookies').get() as {
        encrypted_value: Buffer;
      };
      const plain = decryptChromiumValue(row.encrypted_value, brave.key);
      expect(plain?.toString('utf8')).toBe('cookie-value');
    } finally {
      await cookies.close();
    }
  });

  it('dry-run does not write target files', async () => {
    const arc = await createMockArcProfile(tmp);
    const brave = await createEmptyBraveProfile(tmp);
    const before = await fs.readdir(brave.profile.path);

    const ui = new ProgressUI(true);
    const ctx: MigratorContext = {
      source: arc.profile,
      target: brave.profile,
      sourceBrowser: fakeBrowser('arc', 'Arc'),
      targetBrowser: fakeBrowser('brave', 'Brave'),
      dryRun: true,
      ui,
      sourceSafeKey: arc.key,
      targetSafeKey: brave.key,
    };

    const r = await new BookmarksMigrator().run(ctx);
    expect(r.itemsFound).toBe(2);
    expect(await fs.pathExists(brave.profile.bookmarks)).toBe(false);
    const after = await fs.readdir(brave.profile.path);
    expect(after).toEqual(before);
  });
});
