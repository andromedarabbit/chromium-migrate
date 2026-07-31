import { execa } from 'execa';
import readline from 'node:readline';
import { getLogger } from '../utils/logger.js';
import type { ProgressUI } from '../utils/progress.js';
import type { BrowserInfo } from '../types/index.js';

export async function isProcessRunning(processName: string): Promise<boolean> {
  try {
    // -x exact on Unix; on Windows fall back to tasklist matching later
    if (process.platform === 'win32') {
      const { stdout } = await execa('tasklist', ['/FI', `IMAGENAME eq ${processName}`]);
      return stdout.toLowerCase().includes(processName.toLowerCase());
    }
    const { stdout } = await execa('pgrep', ['-x', processName]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function isBundleRunning(bundleId: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const { stdout } = await execa('pgrep', ['-f', bundleId]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function terminateProcess(processName: string, force = false): Promise<boolean> {
  const logger = getLogger();
  try {
    if (process.platform === 'win32') {
      await execa('taskkill', force ? ['/F', '/IM', processName] : ['/IM', processName]);
    } else if (force) {
      await execa('pkill', ['-9', '-x', processName]);
    } else {
      await execa('pkill', ['-x', processName]);
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!(await isProcessRunning(processName))) {
        logger.info(`Terminated process: ${processName}`);
        return true;
      }
    }
    if (!force) {
      return terminateProcess(processName, true);
    }
    return !(await isProcessRunning(processName));
  } catch (err) {
    logger.warn(`Failed to terminate ${processName}: ${String(err)}`);
    return !(await isProcessRunning(processName));
  }
}

async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function isBrowserRunning(browser: BrowserInfo): Promise<boolean> {
  for (const name of browser.processNames) {
    if (await isProcessRunning(name)) return true;
  }
  for (const bundleId of browser.bundleIds) {
    if (await isBundleRunning(bundleId)) return true;
  }
  return false;
}

export async function terminateBrowser(browser: BrowserInfo): Promise<boolean> {
  let ok = true;
  for (const name of browser.processNames) {
    if (await isProcessRunning(name)) {
      const terminated = await terminateProcess(name);
      ok = ok && terminated;
    }
  }
  return ok && !(await isBrowserRunning(browser));
}

export interface PreflightResult {
  running: string[];
  terminated: string[];
  ok: boolean;
  message: string;
}

export async function ensureBrowsersClosed(
  browsers: BrowserInfo[],
  options: {
    terminate: boolean;
    force: boolean;
    ui?: ProgressUI;
  },
): Promise<PreflightResult> {
  const running: BrowserInfo[] = [];
  for (const b of browsers) {
    if (await isBrowserRunning(b)) running.push(b);
  }

  if (running.length === 0) {
    return {
      running: [],
      terminated: [],
      ok: true,
      message: 'Required browsers are closed.',
    };
  }

  const names = running.map((b) => b.displayName);
  options.ui?.warn(`${names.join(' and ')} currently running.`);

  let shouldTerminate = options.terminate || options.force;
  if (!shouldTerminate) {
    shouldTerminate = await askYesNo(
      'Browsers must be closed before migration. Terminate them now?',
    );
  }

  if (!shouldTerminate) {
    return {
      running: names,
      terminated: [],
      ok: false,
      message: `Please quit ${names.join(' and ')} and retry.`,
    };
  }

  const terminated: string[] = [];
  for (const b of running) {
    options.ui?.updateSpinner(`Terminating ${b.displayName}…`);
    if (await terminateBrowser(b)) terminated.push(b.displayName);
  }

  const stillRunning: string[] = [];
  for (const b of browsers) {
    if (await isBrowserRunning(b)) stillRunning.push(b.displayName);
  }

  if (stillRunning.length > 0) {
    return {
      running: stillRunning,
      terminated,
      ok: false,
      message: `Could not terminate: ${stillRunning.join(', ')}. Quit them manually and retry.`,
    };
  }

  return {
    running: [],
    terminated,
    ok: true,
    message: 'Browsers terminated successfully.',
  };
}
