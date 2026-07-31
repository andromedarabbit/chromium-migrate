import fs from 'fs-extra';
import path from 'node:path';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { encryptChromiumValue } from '../../src/services/crypto.js';
import { buildProfilePaths } from '../../src/browsers/discovery.js';

function deriveKey(password: string): Buffer {
  return crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), 'saltysalt', 1003, 16, 'sha1');
}

export interface FixtureProfile {
  root: string;
  profile: ReturnType<typeof buildProfilePaths>;
  key: Buffer;
}

export async function createMockArcProfile(baseDir: string, keyPassword = 'arc-test'): Promise<FixtureProfile> {
  const root = path.join(baseDir, 'Arc');
  const profileDir = path.join(root, 'Default');
  await fs.ensureDir(profileDir);
  const key = deriveKey(keyPassword);

  // Bookmarks
  await fs.writeJson(path.join(profileDir, 'Bookmarks'), {
    checksum: '',
    roots: {
      bookmark_bar: {
        children: [
          {
            type: 'folder',
            name: 'Dev',
            children: [
              {
                type: 'url',
                name: 'Example',
                url: 'https://example.com',
                date_added: '13300000000000000',
              },
              {
                type: 'url',
                name: 'Brave',
                url: 'https://brave.com',
                date_added: '13300000000000001',
              },
            ],
          },
        ],
        type: 'folder',
        name: 'Bookmarks Bar',
      },
      other: { children: [], type: 'folder', name: 'Other Bookmarks' },
      synced: { children: [], type: 'folder', name: 'Mobile Bookmarks' },
    },
    version: 1,
  });

  // History
  const hist = new Database(path.join(profileDir, 'History'));
  hist.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY,
      url TEXT,
      title TEXT,
      visit_count INTEGER DEFAULT 1,
      typed_count INTEGER DEFAULT 0,
      last_visit_time INTEGER,
      hidden INTEGER DEFAULT 0
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      url INTEGER,
      visit_time INTEGER,
      from_visit INTEGER,
      transition INTEGER DEFAULT 0,
      segment_id INTEGER,
      visit_duration INTEGER DEFAULT 0
    );
    CREATE TABLE downloads (
      id INTEGER PRIMARY KEY,
      current_path TEXT,
      target_path TEXT,
      start_time INTEGER,
      received_bytes INTEGER,
      total_bytes INTEGER,
      state INTEGER,
      danger_type INTEGER,
      interrupt_reason INTEGER,
      hash BLOB,
      end_time INTEGER,
      opened INTEGER,
      referrer TEXT,
      site_url TEXT,
      tab_url TEXT,
      tab_referrer_url TEXT,
      http_method TEXT,
      by_ext_id TEXT,
      by_ext_name TEXT,
      etag TEXT,
      last_modified TEXT,
      mime_type TEXT,
      original_mime_type TEXT
    );
  `);
  hist.prepare(
    'INSERT INTO urls (id, url, title, visit_count, last_visit_time) VALUES (1, ?, ?, 3, ?)',
  ).run('https://example.com', 'Example', 13300000000000000);
  hist.prepare(
    'INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (1, 1, ?, ?)',
  ).run(13300000000000000, 5000000);
  hist.prepare(
    `INSERT INTO downloads (id, current_path, target_path, start_time, received_bytes, total_bytes, state, danger_type, interrupt_reason, end_time, opened, referrer, mime_type)
     VALUES (1, '/tmp/file.zip', '/tmp/file.zip', 13300000000000000, 100, 100, 1, 0, 0, 13300000000000001, 0, 'https://example.com', 'application/zip')`,
  ).run();
  hist.close();

  // Login Data
  const login = new Database(path.join(profileDir, 'Login Data'));
  login.exec(`
    CREATE TABLE logins (
      origin_url TEXT NOT NULL,
      action_url TEXT,
      username_element TEXT,
      username_value TEXT,
      password_element TEXT,
      password_value BLOB,
      submit_element TEXT,
      signon_realm TEXT NOT NULL,
      date_created INTEGER,
      blacklisted_by_user INTEGER DEFAULT 0,
      scheme INTEGER DEFAULT 0,
      password_type INTEGER DEFAULT 0,
      times_used INTEGER DEFAULT 0,
      form_data BLOB,
      date_synced INTEGER DEFAULT 0,
      display_name TEXT,
      icon_url TEXT,
      federation_url TEXT,
      skip_zero_click INTEGER DEFAULT 0,
      generation_upload_status INTEGER DEFAULT 0,
      possible_username_pairs BLOB,
      id INTEGER PRIMARY KEY,
      date_last_used INTEGER DEFAULT 0,
      moving_blocked_for BLOB,
      date_password_modified INTEGER DEFAULT 0
    );
  `);
  const encPw = encryptChromiumValue(Buffer.from('s3cret', 'utf8'), key);
  login
    .prepare(
      `INSERT INTO logins (origin_url, username_value, password_value, signon_realm, date_created, times_used, date_last_used, date_password_modified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'https://example.com/login',
      'user@example.com',
      encPw,
      'https://example.com/',
      13300000000000000,
      5,
      13300000000000000,
      13300000000000000,
    );
  login.close();

  // Cookies
  await fs.ensureDir(path.join(profileDir, 'Network'));
  const cookies = new Database(path.join(profileDir, 'Network', 'Cookies'));
  cookies.exec(`
    CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL,
      host_key TEXT NOT NULL,
      top_frame_site_key TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      encrypted_value BLOB NOT NULL DEFAULT X'',
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL,
      has_expires INTEGER NOT NULL DEFAULT 1,
      is_persistent INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 1,
      samesite INTEGER NOT NULL DEFAULT -1,
      source_scheme INTEGER NOT NULL DEFAULT 0,
      source_port INTEGER NOT NULL DEFAULT -1,
      last_update_utc INTEGER NOT NULL DEFAULT 0
    );
  `);
  const encCookie = encryptChromiumValue(Buffer.from('cookie-value', 'utf8'), key);
  cookies
    .prepare(
      `INSERT INTO cookies (creation_utc, host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, samesite)
       VALUES (?, ?, ?, '', ?, '/', ?, 1, 1, ?, 1, 1, 1, 0)`,
    )
    .run(13300000000000000, '.example.com', 'session', encCookie, 13310000000000000, 13300000000000000);
  cookies.close();

  // Web Data (autofill)
  const web = new Database(path.join(profileDir, 'Web Data'));
  web.exec(`
    CREATE TABLE autofill (
      name TEXT,
      value TEXT,
      value_lower TEXT,
      date_created INTEGER DEFAULT 0,
      date_last_used INTEGER DEFAULT 0,
      count INTEGER DEFAULT 1
    );
    CREATE TABLE autofill_profiles (
      guid TEXT PRIMARY KEY,
      date_modified INTEGER DEFAULT 0,
      origin TEXT DEFAULT '',
      use_count INTEGER DEFAULT 0,
      use_date INTEGER DEFAULT 0
    );
  `);
  web.prepare(
    'INSERT INTO autofill (name, value, value_lower, date_created, count) VALUES (?, ?, ?, ?, ?)',
  ).run('email', 'user@example.com', 'user@example.com', 13300000000000000, 3);
  web.close();

  // Favicons
  const fav = new Database(path.join(profileDir, 'Favicons'));
  fav.exec(`
    CREATE TABLE favicons (id INTEGER PRIMARY KEY, url TEXT, icon_type INTEGER DEFAULT 1);
    CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER, image_data BLOB);
  `);
  fav.prepare('INSERT INTO favicons (id, url) VALUES (1, ?)').run('https://example.com/favicon.ico');
  fav.prepare('INSERT INTO favicon_bitmaps (id, icon_id, image_data) VALUES (1, 1, ?)').run(
    Buffer.from([0, 1, 2, 3]),
  );
  fav.close();

  // Top Sites
  const top = new Database(path.join(profileDir, 'Top Sites'));
  top.exec('CREATE TABLE top_sites (url TEXT, title TEXT, url_rank INTEGER);');
  top.prepare('INSERT INTO top_sites VALUES (?, ?, ?)').run('https://example.com', 'Example', 1);
  top.close();

  // Preferences
  await fs.writeJson(path.join(profileDir, 'Preferences'), {
    homepage: 'https://example.com',
    homepage_is_newtabpage: false,
    session: { restore_on_startup: 4, startup_urls: ['https://example.com'] },
    profile: {
      content_settings: {
        exceptions: {
          notifications: {
            'https://example.com:443,*': { setting: 1 },
          },
          media_stream_camera: {},
          geolocation: {
            'https://maps.example.com:443,*': { setting: 1 },
          },
        },
      },
      default_zoom_level: 0,
    },
    download: { default_directory: '/Users/test/Downloads' },
    intl: { accept_languages: 'en-US,en' },
  });

  // Extensions stub
  const extId = 'abcdefghijklmnopqrstuvwxyzabcdef';
  await fs.ensureDir(path.join(profileDir, 'Extensions', extId, '1.0.0'));
  await fs.writeJson(path.join(profileDir, 'Extensions', extId, '1.0.0', 'manifest.json'), {
    name: 'Test Extension',
    version: '1.0.0',
    manifest_version: 3,
  });

  // Sessions
  await fs.writeFile(path.join(profileDir, 'Current Session'), Buffer.from('SNSS'));
  await fs.writeFile(path.join(profileDir, 'Current Tabs'), Buffer.from('SNSS'));

  await fs.writeFile(path.join(root, 'Last Version'), '1.0.0');
  await fs.writeJson(path.join(root, 'Local State'), {
    profile: {
      info_cache: {
        Default: { name: 'Person 1', active_time: Date.now() / 1000 },
      },
      last_used: 'Default',
    },
  });

  return {
    root,
    profile: buildProfilePaths(profileDir, 'Default'),
    key,
  };
}

export async function createEmptyBraveProfile(baseDir: string): Promise<FixtureProfile> {
  const root = path.join(baseDir, 'Brave');
  const profileDir = path.join(root, 'Default');
  await fs.ensureDir(profileDir);
  await fs.writeJson(path.join(profileDir, 'Preferences'), { profile: { name: 'Default' } });
  await fs.writeFile(path.join(root, 'Last Version'), '1.0.0');
  return {
    root,
    profile: buildProfilePaths(profileDir, 'Default'),
    key: deriveKey('brave-test'),
  };
}
