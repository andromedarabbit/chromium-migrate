import fs from 'fs-extra';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { BrowserInfo, DiscoveredProfile, ProfilePaths } from '../types/index.js';
import {
  getBrowserDefinition,
  getPlatform,
  listBrowserIds,
  resolveBrowserId,
  resolveUserDataCandidates,
  type BrowserDefinition,
  type BrowserId,
} from './registry.js';
import { getDirectorySize, safeJsonParse } from '../utils/helpers.js';
import { getLogger } from '../utils/logger.js';

export function buildProfilePaths(profileDir: string, name: string): ProfilePaths {
  return {
    name,
    path: profileDir,
    bookmarks: path.join(profileDir, 'Bookmarks'),
    history: path.join(profileDir, 'History'),
    historyJournal: path.join(profileDir, 'History-journal'),
    cookies: path.join(profileDir, 'Cookies'),
    loginData: path.join(profileDir, 'Login Data'),
    webData: path.join(profileDir, 'Web Data'),
    favicons: path.join(profileDir, 'Favicons'),
    topSites: path.join(profileDir, 'Top Sites'),
    preferences: path.join(profileDir, 'Preferences'),
    securePreferences: path.join(profileDir, 'Secure Preferences'),
    currentSession: path.join(profileDir, 'Current Session'),
    currentTabs: path.join(profileDir, 'Current Tabs'),
    lastSession: path.join(profileDir, 'Last Session'),
    lastTabs: path.join(profileDir, 'Last Tabs'),
    sessions: path.join(profileDir, 'Sessions'),
    extensions: path.join(profileDir, 'Extensions'),
    extensionState: path.join(profileDir, 'Extension State'),
    extensionRules: path.join(profileDir, 'Extension Rules'),
    localExtensionSettings: path.join(profileDir, 'Local Extension Settings'),
    syncExtensionSettings: path.join(profileDir, 'Sync Extension Settings'),
    networkPersistentState: path.join(profileDir, 'Network Persistent State'),
    shortcuts: path.join(profileDir, 'Shortcuts'),
    visitedLinks: path.join(profileDir, 'Visited Links'),
    transportSecurity: path.join(profileDir, 'TransportSecurity'),
  };
}

/** Resolve Cookies path — Chromium moved it under Network/ */
export async function resolveCookiesPath(profileDir: string): Promise<string> {
  const network = path.join(profileDir, 'Network', 'Cookies');
  const legacy = path.join(profileDir, 'Cookies');
  if (await fs.pathExists(network)) return network;
  return legacy;
}

export async function resolveLoginDataPath(profileDir: string): Promise<string> {
  return path.join(profileDir, 'Login Data');
}

interface LocalState {
  profile?: {
    info_cache?: Record<
      string,
      {
        name?: string;
        user_name?: string;
        is_using_default_name?: boolean;
        active_time?: number;
      }
    >;
    last_used?: string;
  };
}

async function countTable(dbPath: string, table: string): Promise<number | undefined> {
  if (!(await fs.pathExists(dbPath))) return undefined;
  try {
    const tmp = `${dbPath}.cmigrate-ro-${process.pid}`;
    await fs.copy(dbPath, tmp);
    const db = new Database(tmp, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      return row.c;
    } finally {
      db.close();
      await fs.remove(tmp).catch(() => undefined);
    }
  } catch {
    return undefined;
  }
}

async function countBookmarks(bookmarksPath: string): Promise<number | undefined> {
  if (!(await fs.pathExists(bookmarksPath))) return undefined;
  try {
    const raw = await fs.readFile(bookmarksPath, 'utf8');
    const data = safeJsonParse<{ roots?: Record<string, unknown> }>(raw, {});
    let count = 0;
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; children?: unknown[] };
      if (n.type === 'url') count++;
      if (Array.isArray(n.children)) n.children.forEach(walk);
    };
    if (data.roots) {
      for (const root of Object.values(data.roots)) walk(root);
    }
    return count;
  } catch {
    return undefined;
  }
}

async function discoverProfiles(root: string): Promise<DiscoveredProfile[]> {
  const profiles: DiscoveredProfile[] = [];
  if (!(await fs.pathExists(root))) return profiles;

  const localStatePath = path.join(root, 'Local State');
  let localState: LocalState = {};
  if (await fs.pathExists(localStatePath)) {
    const raw = await fs.readFile(localStatePath, 'utf8');
    localState = safeJsonParse<LocalState>(raw, {});
  }

  const infoCache = localState.profile?.info_cache ?? {};
  const candidates = new Set<string>(['Default', 'Guest Profile', ...Object.keys(infoCache)]);

  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name === 'Default' ||
      entry.name === 'Guest Profile' ||
      /^Profile \d+$/.test(entry.name)
    ) {
      candidates.add(entry.name);
    }
  }

  for (const name of candidates) {
    const profilePath = path.join(root, name);
    if (!(await fs.pathExists(profilePath))) continue;
    const prefsPath = path.join(profilePath, 'Preferences');
    if (!(await fs.pathExists(prefsPath)) && name !== 'Guest Profile') {
      const hasData =
        (await fs.pathExists(path.join(profilePath, 'Bookmarks'))) ||
        (await fs.pathExists(path.join(profilePath, 'History')));
      if (!hasData) continue;
    }

    const meta = infoCache[name];
    const cookiesPath = await resolveCookiesPath(profilePath);
    const sizeBytes = await getDirectorySize(profilePath);

    const [bookmarkCount, historyCount, passwordCount, cookieCount] = await Promise.all([
      countBookmarks(path.join(profilePath, 'Bookmarks')),
      countTable(path.join(profilePath, 'History'), 'urls'),
      countTable(path.join(profilePath, 'Login Data'), 'logins'),
      countTable(cookiesPath, 'cookies'),
    ]);

    let extensionCount = 0;
    const extDir = path.join(profilePath, 'Extensions');
    if (await fs.pathExists(extDir)) {
      const extEntries = await fs.readdir(extDir);
      extensionCount = extEntries.filter((e) => !e.startsWith('.')).length;
    }

    profiles.push({
      name,
      path: profilePath,
      isDefault: name === 'Default' || name === localState.profile?.last_used,
      lastActive: meta?.active_time,
      bookmarkCount,
      historyCount,
      passwordCount,
      cookieCount,
      extensionCount,
      sizeBytes,
    });
  }

  profiles.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });

  return profiles;
}

async function readBrowserVersion(root: string): Promise<string | undefined> {
  const lastVersion = path.join(root, 'Last Version');
  if (await fs.pathExists(lastVersion)) {
    return (await fs.readFile(lastVersion, 'utf8')).trim();
  }
  return undefined;
}

async function resolveExistingRoot(def: BrowserDefinition): Promise<string | null> {
  const candidates = resolveUserDataCandidates(def);
  for (const candidate of candidates) {
    // Skip glob-like Windows Arc package paths for now
    if (candidate.includes('*')) continue;
    if (await fs.pathExists(candidate)) return candidate;
  }
  return candidates[0] ?? null;
}

export async function discoverBrowser(browser: BrowserId | string): Promise<BrowserInfo> {
  const id = resolveBrowserId(browser);
  const def = getBrowserDefinition(id);
  const platform = getPlatform();
  const rootPath = (await resolveExistingRoot(def)) ?? resolveUserDataCandidates(def)[0] ?? '';
  const exists = rootPath ? await fs.pathExists(rootPath) : false;
  const profiles = exists ? await discoverProfiles(rootPath) : [];
  const version = exists ? await readBrowserVersion(rootPath) : undefined;
  const safe = def.safeStorage[platform];

  getLogger().info(
    `Discovered ${def.displayName}: exists=${exists}, profiles=${profiles.length}, root=${rootPath}`,
  );

  return {
    id,
    name: def.displayName,
    displayName: def.displayName,
    rootPath,
    exists,
    version,
    profiles,
    processNames: def.processNames[platform] ?? [],
    bundleIds: def.bundleIds ?? [],
    safeStorageService: safe?.service ?? `${def.displayName} Safe Storage`,
    safeStorageAccount: safe?.account ?? def.displayName,
    safeStorageFallbacks: safe?.fallbacks ?? ['Chrome Safe Storage', 'Chromium Safe Storage'],
    enrichments: def.enrichments ?? [],
    notes: def.notes ?? [],
    platform,
  };
}

/** Discover all registered browsers that have profile data on this machine */
export async function discoverAllBrowsers(): Promise<BrowserInfo[]> {
  const results: BrowserInfo[] = [];
  for (const id of listBrowserIds()) {
    const info = await discoverBrowser(id);
    if (info.exists) results.push(info);
  }
  return results;
}

export async function resolveProfile(
  browser: BrowserInfo,
  profileName: string,
): Promise<ProfilePaths> {
  const found = browser.profiles.find(
    (p) => p.name === profileName || p.name.toLowerCase() === profileName.toLowerCase(),
  );
  if (!found) {
    const available = browser.profiles.map((p) => p.name).join(', ') || '(none)';
    throw new Error(
      `Profile "${profileName}" not found in ${browser.displayName}. Available: ${available}`,
    );
  }
  const paths = buildProfilePaths(found.path, found.name);
  paths.cookies = await resolveCookiesPath(found.path);
  paths.loginData = await resolveLoginDataPath(found.path);
  return paths;
}

export async function ensureTargetProfile(
  browserRoot: string,
  profileName: string,
): Promise<ProfilePaths> {
  const profilePath = path.join(browserRoot, profileName);
  await fs.ensureDir(profilePath);
  return buildProfilePaths(profilePath, profileName);
}

/** @deprecated Use discoverBrowser('arc') */
export async function discoverArc(): Promise<BrowserInfo> {
  return discoverBrowser('arc');
}

/** @deprecated Use discoverBrowser('brave') */
export async function discoverBrave(): Promise<BrowserInfo> {
  return discoverBrowser('brave');
}

/** @deprecated Use ensureTargetProfile */
export async function ensureBraveProfile(
  braveRoot: string,
  profileName: string,
): Promise<ProfilePaths> {
  return ensureTargetProfile(braveRoot, profileName);
}
