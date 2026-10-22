import os from 'node:os';
import path from 'node:path';

export type Platform = 'darwin' | 'linux' | 'win32';

export type BrowserId =
  | 'arc'
  | 'brave'
  | 'chrome'
  | 'chrome-canary'
  | 'chromium'
  | 'edge'
  | 'vivaldi'
  | 'opera'
  | 'opera-gx'
  | 'thorium'
  | 'dia'
  | 'ego-lite';

export interface SafeStorageConfig {
  service: string;
  account: string;
  fallbacks: string[];
}

export interface BrowserDefinition {
  id: BrowserId;
  displayName: string;
  /** Chromium family — currently the only supported engine */
  family: 'chromium';
  /** Process names used for running-check / terminate */
  processNames: Partial<Record<Platform, string[]>>;
  /** macOS bundle identifiers */
  bundleIds?: string[];
  /**
   * Candidate user-data roots (first existing wins).
   * Paths may include `{home}` which expands to os.homedir().
   */
  userDataPaths: Partial<Record<Platform, string[]>>;
  /** Keychain / secret-service names for cookie & password encryption */
  safeStorage: Partial<Record<Platform, SafeStorageConfig>>;
  /**
   * Optional browser-specific enrichments run after core Chromium migrate.
   * Example: Arc sidebar → bookmarks.
   */
  enrichments?: Array<'arc-sidebar'>;
  /** Short aliases accepted by CLI (--from/--to) */
  aliases?: string[];
  notes?: string[];
}

function home(...parts: string[]): string {
  return path.join('{home}', ...parts);
}

/**
 * Registry of supported Chromium-based browsers.
 * Paths are templates — never machine-specific absolute paths.
 */
export const BROWSER_REGISTRY: Record<BrowserId, BrowserDefinition> = {
  chrome: {
    id: 'chrome',
    displayName: 'Google Chrome',
    family: 'chromium',
    aliases: ['google-chrome', 'googlechrome'],
    processNames: {
      darwin: ['Google Chrome'],
      linux: ['chrome', 'google-chrome', 'google-chrome-stable'],
      win32: ['chrome.exe'],
    },
    bundleIds: ['com.google.Chrome'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Google', 'Chrome')],
      linux: [
        home('.config', 'google-chrome'),
        home('.config', 'google-chrome-stable'),
      ],
      win32: [home('AppData', 'Local', 'Google', 'Chrome', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Chrome Safe Storage',
        account: 'Chrome',
        fallbacks: ['Chromium Safe Storage'],
      },
    },
  },
  'chrome-canary': {
    id: 'chrome-canary',
    displayName: 'Google Chrome Canary',
    family: 'chromium',
    aliases: ['canary', 'chrome-canary'],
    processNames: {
      darwin: ['Google Chrome Canary'],
      linux: ['google-chrome-canary'],
      win32: ['chrome.exe'],
    },
    bundleIds: ['com.google.Chrome.canary'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Google', 'Chrome Canary')],
      linux: [home('.config', 'google-chrome-canary')],
      win32: [home('AppData', 'Local', 'Google', 'Chrome SxS', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Chrome Safe Storage',
        account: 'Chrome',
        fallbacks: ['Chromium Safe Storage'],
      },
    },
  },
  chromium: {
    id: 'chromium',
    displayName: 'Chromium',
    family: 'chromium',
    processNames: {
      darwin: ['Chromium'],
      linux: ['chromium', 'chromium-browser'],
      win32: ['chrome.exe'],
    },
    bundleIds: ['org.chromium.Chromium'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Chromium')],
      linux: [home('.config', 'chromium'), home('.config', 'chromium-browser')],
      win32: [home('AppData', 'Local', 'Chromium', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Chromium Safe Storage',
        account: 'Chromium',
        fallbacks: ['Chrome Safe Storage'],
      },
    },
  },
  brave: {
    id: 'brave',
    displayName: 'Brave',
    family: 'chromium',
    aliases: ['brave-browser'],
    processNames: {
      darwin: ['Brave Browser'],
      linux: ['brave', 'brave-browser'],
      win32: ['brave.exe'],
    },
    bundleIds: ['com.brave.Browser'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')],
      linux: [home('.config', 'BraveSoftware', 'Brave-Browser')],
      win32: [home('AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Brave Safe Storage',
        account: 'Brave',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
  },
  arc: {
    id: 'arc',
    displayName: 'Arc',
    family: 'chromium',
    processNames: {
      darwin: ['Arc'],
      // Arc is primarily macOS/Windows; Linux uncommon
      win32: ['Arc.exe'],
    },
    bundleIds: ['company.thebrowser.Browser'],
    userDataPaths: {
      // Arc nests Chromium profile data under …/Arc/User Data
      darwin: [home('Library', 'Application Support', 'Arc', 'User Data')],
      win32: [home('AppData', 'Local', 'Packages', 'TheBrowserCompany.Arc_*', 'LocalCache', 'Local', 'Arc', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Arc Safe Storage',
        account: 'Arc',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
    enrichments: ['arc-sidebar'],
    notes: [
      'Arc Spaces, Boosts, and Easels are not portable to other browsers',
      'Sidebar favorites are imported as bookmarks when Arc is the source',
    ],
  },
  edge: {
    id: 'edge',
    displayName: 'Microsoft Edge',
    family: 'chromium',
    aliases: ['msedge', 'microsoft-edge'],
    processNames: {
      darwin: ['Microsoft Edge'],
      linux: ['microsoft-edge', 'microsoft-edge-stable'],
      win32: ['msedge.exe'],
    },
    bundleIds: ['com.microsoft.edgemac'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Microsoft Edge')],
      linux: [home('.config', 'microsoft-edge')],
      win32: [home('AppData', 'Local', 'Microsoft', 'Edge', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Microsoft Edge Safe Storage',
        account: 'Microsoft Edge',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
  },
  vivaldi: {
    id: 'vivaldi',
    displayName: 'Vivaldi',
    family: 'chromium',
    processNames: {
      darwin: ['Vivaldi'],
      linux: ['vivaldi', 'vivaldi-bin'],
      win32: ['vivaldi.exe'],
    },
    bundleIds: ['com.vivaldi.Vivaldi'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Vivaldi')],
      linux: [home('.config', 'vivaldi')],
      win32: [home('AppData', 'Local', 'Vivaldi', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Vivaldi Safe Storage',
        account: 'Vivaldi',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
  },
  opera: {
    id: 'opera',
    displayName: 'Opera',
    family: 'chromium',
    processNames: {
      darwin: ['Opera'],
      linux: ['opera'],
      win32: ['opera.exe'],
    },
    bundleIds: ['com.operasoftware.Opera'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'com.operasoftware.Opera')],
      linux: [home('.config', 'opera')],
      win32: [home('AppData', 'Roaming', 'Opera Software', 'Opera Stable')],
    },
    safeStorage: {
      darwin: {
        service: 'Opera Safe Storage',
        account: 'Opera',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
  },
  'opera-gx': {
    id: 'opera-gx',
    displayName: 'Opera GX',
    family: 'chromium',
    aliases: ['operagx'],
    processNames: {
      darwin: ['Opera GX'],
      win32: ['opera.exe'],
    },
    bundleIds: ['com.operasoftware.OperaGX'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'com.operasoftware.OperaGX')],
      win32: [home('AppData', 'Roaming', 'Opera Software', 'Opera GX Stable')],
    },
    safeStorage: {
      darwin: {
        service: 'Opera Safe Storage',
        account: 'Opera',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
  },
  thorium: {
    id: 'thorium',
    displayName: 'Thorium',
    family: 'chromium',
    processNames: {
      darwin: ['Thorium'],
      linux: ['thorium', 'thorium-browser'],
      win32: ['thorium.exe'],
    },
    bundleIds: ['org.chromium.Thorium'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Thorium')],
      linux: [home('.config', 'thorium')],
      win32: [home('AppData', 'Local', 'Thorium', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Chromium Safe Storage',
        account: 'Chromium',
        fallbacks: ['Chrome Safe Storage'],
      },
    },
  },
  dia: {
    id: 'dia',
    displayName: 'Dia',
    family: 'chromium',
    processNames: {
      darwin: ['Dia'],
    },
    bundleIds: ['company.thebrowser.dia'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Dia', 'User Data')],
    },
    safeStorage: {
      darwin: {
        service: 'Dia Safe Storage',
        account: 'Dia',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
    notes: ['Dia support is experimental'],
  },
  'ego-lite': {
    id: 'ego-lite',
    displayName: 'ego lite',
    family: 'chromium',
    processNames: {
      darwin: ['ego lite'],
    },
    bundleIds: ['com.citrolabs.ego.lite'],
    userDataPaths: {
      darwin: [home('Library', 'Application Support', 'Citro Labs', 'ego lite')],
    },
    safeStorage: {
      darwin: {
        // live-verified: ego deviates from the "<name> Safe Storage" convention
        service: 'ego safe storage',
        account: 'ego',
        fallbacks: ['Chrome Safe Storage', 'Chromium Safe Storage'],
      },
    },
    notes: ['ego lite support is experimental', 'Windows support pending verification'],
  },
};

export function getPlatform(): Platform {
  const p = process.platform;
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p;
  throw new Error(`Unsupported platform: ${p}. Supported: darwin, linux, win32.`);
}

export function expandPath(template: string): string {
  return template.replaceAll('{home}', os.homedir());
}

export function resolveBrowserId(input: string): BrowserId {
  const normalized = input.trim().toLowerCase();
  if (normalized in BROWSER_REGISTRY) {
    return normalized as BrowserId;
  }
  for (const def of Object.values(BROWSER_REGISTRY)) {
    if (def.aliases?.some((a) => a.toLowerCase() === normalized)) {
      return def.id;
    }
    if (def.displayName.toLowerCase() === normalized) {
      return def.id;
    }
  }
  const known = listBrowserIds().join(', ');
  throw new Error(`Unknown browser "${input}". Supported: ${known}`);
}

export function getBrowserDefinition(id: BrowserId | string): BrowserDefinition {
  const resolved = typeof id === 'string' ? resolveBrowserId(id) : id;
  return BROWSER_REGISTRY[resolved];
}

export function listBrowserIds(): BrowserId[] {
  return Object.keys(BROWSER_REGISTRY) as BrowserId[];
}

export function listBrowsersForPlatform(platform = getPlatform()): BrowserDefinition[] {
  return Object.values(BROWSER_REGISTRY).filter((b) => {
    const paths = b.userDataPaths[platform];
    return Boolean(paths && paths.length > 0);
  });
}

export function resolveUserDataCandidates(def: BrowserDefinition, platform = getPlatform()): string[] {
  const templates = def.userDataPaths[platform] ?? [];
  return templates.map(expandPath);
}
