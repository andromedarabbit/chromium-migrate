import fs from 'fs-extra';
import {
  countRows,
  openReadonlyCopy,
  tableExists,
} from '../database/sqlite.js';
import type { ProfilePaths, VerificationResult } from '../types/index.js';
import { safeJsonParse } from '../utils/helpers.js';

function countBookmarks(data: unknown): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; children?: unknown[] };
    if (n.type === 'url') count++;
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  const roots = (data as { roots?: Record<string, unknown> })?.roots;
  if (roots) Object.values(roots).forEach(walk);
  return count;
}

async function countDb(path: string, table: string): Promise<number> {
  if (!(await fs.pathExists(path))) return 0;
  const handle = await openReadonlyCopy(path);
  try {
    if (!tableExists(handle.db, table)) return 0;
    return countRows(handle.db, table);
  } finally {
    await handle.close();
  }
}

export async function verifyMigration(
  source: ProfilePaths,
  target: ProfilePaths,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  // Bookmarks
  let srcBm = 0;
  let dstBm = 0;
  if (await fs.pathExists(source.bookmarks)) {
    srcBm = countBookmarks(safeJsonParse(await fs.readFile(source.bookmarks, 'utf8'), {}));
  }
  if (await fs.pathExists(target.bookmarks)) {
    dstBm = countBookmarks(safeJsonParse(await fs.readFile(target.bookmarks, 'utf8'), {}));
  }
  results.push({
    category: 'bookmarks',
    sourceCount: srcBm,
    targetCount: dstBm,
    match: srcBm === dstBm,
    delta: dstBm - srcBm,
  });

  // History
  const srcHist = await countDb(source.history, 'urls');
  const dstHist = await countDb(target.history, 'urls');
  results.push({
    category: 'history',
    sourceCount: srcHist,
    targetCount: dstHist,
    match: srcHist === dstHist,
    delta: dstHist - srcHist,
  });

  // Passwords
  const srcPw = await countDb(source.loginData, 'logins');
  const dstPw = await countDb(target.loginData, 'logins');
  results.push({
    category: 'passwords',
    sourceCount: srcPw,
    targetCount: dstPw,
    match: srcPw === dstPw,
    delta: dstPw - srcPw,
  });

  // Cookies
  const srcCk = await countDb(source.cookies, 'cookies');
  const dstCk = await countDb(target.cookies, 'cookies');
  results.push({
    category: 'cookies',
    sourceCount: srcCk,
    targetCount: dstCk,
    match: srcCk === dstCk,
    delta: dstCk - srcCk,
  });

  // Downloads
  const srcDl = await countDb(source.history, 'downloads');
  const dstDl = await countDb(target.history, 'downloads');
  results.push({
    category: 'downloads',
    sourceCount: srcDl,
    targetCount: dstDl,
    match: srcDl === dstDl,
    delta: dstDl - srcDl,
  });

  // Autofill
  const srcAf = await countDb(source.webData, 'autofill');
  const dstAf = await countDb(target.webData, 'autofill');
  results.push({
    category: 'autofill',
    sourceCount: srcAf,
    targetCount: dstAf,
    match: srcAf === dstAf,
    delta: dstAf - srcAf,
  });

  // Favicons
  const srcFv = await countDb(source.favicons, 'favicons');
  const dstFv = await countDb(target.favicons, 'favicons');
  results.push({
    category: 'favicons',
    sourceCount: srcFv,
    targetCount: dstFv,
    match: srcFv === dstFv,
    delta: dstFv - srcFv,
  });

  // Extensions
  let srcExt = 0;
  let dstExt = 0;
  if (await fs.pathExists(source.extensions)) {
    srcExt = (await fs.readdir(source.extensions)).filter((n) => !n.startsWith('.')).length;
  }
  if (await fs.pathExists(target.extensions)) {
    dstExt = (await fs.readdir(target.extensions)).filter((n) => !n.startsWith('.')).length;
  }
  results.push({
    category: 'extensions',
    sourceCount: srcExt,
    targetCount: dstExt,
    match: srcExt === dstExt,
    delta: dstExt - srcExt,
  });

  // Preferences exists
  const srcPrefs = (await fs.pathExists(source.preferences)) ? 1 : 0;
  const dstPrefs = (await fs.pathExists(target.preferences)) ? 1 : 0;
  results.push({
    category: 'preferences',
    sourceCount: srcPrefs,
    targetCount: dstPrefs,
    match: dstPrefs === 1,
    delta: dstPrefs - srcPrefs,
  });

  // Sessions
  const sessionFiles = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
  let srcSes = 0;
  let dstSes = 0;
  for (const f of sessionFiles) {
    if (await fs.pathExists(`${source.path}/${f}`)) srcSes++;
    if (await fs.pathExists(`${target.path}/${f}`)) dstSes++;
  }
  results.push({
    category: 'sessions',
    sourceCount: srcSes,
    targetCount: dstSes,
    match: srcSes === dstSes || (srcSes === 0 && dstSes === 0),
    delta: dstSes - srcSes,
  });

  return results;
}
