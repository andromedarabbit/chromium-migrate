export { buildProfilePaths, resolveCookiesPath, discoverBrowser, discoverAllBrowsers } from './discovery.js';
export {
  isProcessRunning,
  terminateProcess,
  ensureBrowsersClosed,
  isBrowserRunning,
} from './process.js';
export {
  BROWSER_REGISTRY,
  getBrowserDefinition,
  listBrowserIds,
  resolveBrowserId,
  getPlatform,
} from './registry.js';
