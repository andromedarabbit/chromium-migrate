/**
 * Core type definitions for Chromium browser profile migration.
 */

import type { BrowserId } from '../browsers/registry.js';

export type { BrowserId };

export type ProfileName = 'Default' | 'Profile 1' | 'Profile 2' | 'Guest' | string;

export type MigrationStage =
  | 'discovery'
  | 'preflight'
  | 'backup'
  | 'bookmarks'
  | 'history'
  | 'downloads'
  | 'autofill'
  | 'passwords'
  | 'cookies'
  | 'extensions'
  | 'sessions'
  | 'permissions'
  | 'preferences'
  | 'favicons'
  | 'top-sites'
  | 'verification'
  | 'report'
  | 'rollback'
  | 'cleanup';

export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'partial';

export interface ProfilePaths {
  name: string;
  path: string;
  bookmarks: string;
  history: string;
  historyJournal: string;
  cookies: string;
  loginData: string;
  webData: string;
  favicons: string;
  topSites: string;
  preferences: string;
  securePreferences: string;
  currentSession: string;
  currentTabs: string;
  lastSession: string;
  lastTabs: string;
  sessions: string;
  extensions: string;
  extensionState: string;
  extensionRules: string;
  localExtensionSettings: string;
  syncExtensionSettings: string;
  networkPersistentState: string;
  shortcuts: string;
  visitedLinks: string;
  transportSecurity: string;
}

export interface DiscoveredProfile {
  name: string;
  path: string;
  isDefault: boolean;
  lastActive?: number;
  bookmarkCount?: number;
  historyCount?: number;
  passwordCount?: number;
  cookieCount?: number;
  extensionCount?: number;
  sizeBytes?: number;
}

export interface BrowserInfo {
  id: BrowserId;
  name: string;
  displayName: string;
  rootPath: string;
  exists: boolean;
  version?: string;
  profiles: DiscoveredProfile[];
  processNames: string[];
  bundleIds: string[];
  safeStorageService: string;
  safeStorageAccount: string;
  safeStorageFallbacks: string[];
  enrichments: Array<'arc-sidebar'>;
  notes: string[];
  platform: string;
}

export interface MigrationOptions {
  sourceBrowser: BrowserId | string;
  targetBrowser: BrowserId | string;
  sourceProfile: string;
  targetProfile: string;
  dryRun: boolean;
  skipBackup: boolean;
  force: boolean;
  includePasswords: boolean;
  includeCookies: boolean;
  includeExtensions: boolean;
  includeHistory: boolean;
  includeBookmarks: boolean;
  includeAutofill: boolean;
  includeSessions: boolean;
  includePermissions: boolean;
  includePreferences: boolean;
  includeDownloads: boolean;
  includeFavicons: boolean;
  terminateBrowsers: boolean;
  continueOnError: boolean;
  verbose: boolean;
  reportFormats: Array<'json' | 'markdown' | 'html'>;
}

export interface StageResult {
  stage: MigrationStage;
  status: StageStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  itemsFound: number;
  itemsTransferred: number;
  itemsSkipped: number;
  itemsFailed: number;
  warnings: string[];
  errors: string[];
  details?: Record<string, unknown>;
}

export interface MigrationReport {
  id: string;
  version: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  source: {
    browser: string;
    browserId: string;
    profile: string;
    path: string;
  };
  target: {
    browser: string;
    browserId: string;
    profile: string;
    path: string;
  };
  dryRun: boolean;
  backupPath?: string;
  stages: StageResult[];
  summary: MigrationSummary;
  failures: string[];
  warnings: string[];
  skippedItems: string[];
}

export interface MigrationSummary {
  bookmarks: CountSummary;
  passwords: CountSummary;
  cookies: CountSummary;
  history: CountSummary;
  downloads: CountSummary;
  extensions: CountSummary;
  autofill: CountSummary;
  permissions: CountSummary;
  preferences: CountSummary;
  sessions: CountSummary;
  favicons: CountSummary;
  overall: {
    success: boolean;
    stagesSucceeded: number;
    stagesFailed: number;
    stagesSkipped: number;
    totalItemsFound: number;
    totalItemsTransferred: number;
  };
}

export interface CountSummary {
  found: number;
  transferred: number;
  skipped: number;
  failed: number;
  verified?: boolean;
  notes?: string[];
}

export interface BackupInfo {
  id: string;
  timestamp: string;
  path: string;
  profileName: string;
  profilePath: string;
  sizeBytes: number;
  manifest: BackupManifest;
}

export interface BackupManifest {
  version: string;
  createdAt: string;
  sourceBrowser: string;
  profileName: string;
  profilePath: string;
  files: string[];
  checksums: Record<string, string>;
}

export interface DryRunEstimate {
  itemsFound: Record<string, number>;
  itemsTransferable: Record<string, number>;
  unsupported: string[];
  warnings: string[];
  diskUsageBytes: number;
  estimatedDurationMs: number;
  sourceSizeBytes: number;
  availableDiskBytes: number;
}

export interface VerificationResult {
  category: string;
  sourceCount: number;
  targetCount: number;
  match: boolean;
  delta: number;
  details?: string[];
}

export interface ExtensionCompatInfo {
  id: string;
  name: string;
  version?: string;
  transferred: boolean;
  compatible: boolean;
  warnings: string[];
  dataRestored: boolean;
}

export interface ProgressUpdate {
  stage: MigrationStage;
  message: string;
  current: number;
  total: number;
  percent: number;
  elapsedMs: number;
  remainingMs?: number;
}

export interface CryptoKeyMaterial {
  service: string;
  account: string;
  key: Buffer;
}

export const DEFAULT_MIGRATION_OPTIONS: MigrationOptions = {
  sourceBrowser: 'chrome',
  targetBrowser: 'brave',
  sourceProfile: 'Default',
  targetProfile: 'Default',
  dryRun: false,
  skipBackup: false,
  force: false,
  includePasswords: true,
  includeCookies: true,
  includeExtensions: true,
  includeHistory: true,
  includeBookmarks: true,
  includeAutofill: true,
  includeSessions: true,
  includePermissions: true,
  includePreferences: true,
  includeDownloads: true,
  includeFavicons: true,
  terminateBrowsers: false,
  continueOnError: true,
  verbose: false,
  reportFormats: ['json', 'markdown', 'html'],
};

export const APP_VERSION = '2.0.0';
export const APP_NAME = 'chromium-migrate';
