import fs from 'fs-extra';
import path from 'node:path';
import type { StageResult } from '../types/index.js';
import { dateToChromeTime, safeJsonParse } from '../utils/helpers.js';
import { BaseMigrator, type MigratorContext } from './base.js';

interface BookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  id?: string;
  guid?: string;
  date_added?: string;
  date_modified?: string;
  date_last_used?: string;
  meta_info?: Record<string, string>;
  children?: BookmarkNode[];
}

interface BookmarksFile {
  checksum?: string;
  roots?: {
    bookmark_bar?: BookmarkNode;
    other?: BookmarkNode;
    synced?: BookmarkNode;
    [key: string]: BookmarkNode | undefined;
  };
  version?: number;
}

function countUrls(node: BookmarkNode | undefined): number {
  if (!node) return 0;
  let n = node.type === 'url' ? 1 : 0;
  if (node.children) {
    for (const child of node.children) n += countUrls(child);
  }
  return n;
}

function chromeTimeNow(): string {
  return String(dateToChromeTime(Date.now()));
}

function makeGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function walkSidebarUrls(node: unknown, out: Array<{ title: string; url: string }>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walkSidebarUrls(child, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const url =
    (typeof obj.savedURL === 'string' && obj.savedURL) ||
    (typeof obj.url === 'string' && obj.url) ||
    null;
  if (url && /^https?:\/\//i.test(url)) {
    const title =
      (typeof obj.savedTitle === 'string' && obj.savedTitle) ||
      (typeof obj.title === 'string' && obj.title) ||
      url;
    out.push({ title, url });
  }
  for (const value of Object.values(obj)) walkSidebarUrls(value, out);
}

function collectUrls(node: BookmarkNode | undefined, set: Set<string>): void {
  if (!node) return;
  if (node.type === 'url' && node.url) set.add(node.url);
  node.children?.forEach((c) => collectUrls(c, set));
}

function resolveSidebarPath(profilePath: string): string {
  // Real Arc: .../Arc/User Data/Default → .../Arc/StorableSidebar.json
  const userData = path.dirname(profilePath);
  const arcRoot = path.basename(userData) === 'User Data' ? path.dirname(userData) : userData;
  return path.join(arcRoot, 'StorableSidebar.json');
}

async function countSidebarFavorites(profilePath: string): Promise<number> {
  const sidebarPath = resolveSidebarPath(profilePath);
  if (!(await fs.pathExists(sidebarPath))) return 0;
  const data = safeJsonParse(await fs.readFile(sidebarPath, 'utf8'), {});
  const items: Array<{ title: string; url: string }> = [];
  walkSidebarUrls(data, items);
  return new Set(items.map((i) => i.url)).size;
}

async function mergeArcSidebarIntoBookmarks(
  bookmarksPath: string,
  profilePath: string,
  warnings: string[],
): Promise<number> {
  const sidebarPath = resolveSidebarPath(profilePath);
  if (!(await fs.pathExists(sidebarPath))) {
    return 0;
  }

  const sidebarData = safeJsonParse(await fs.readFile(sidebarPath, 'utf8'), {});
  const items: Array<{ title: string; url: string }> = [];
  walkSidebarUrls(sidebarData, items);
  const unique = new Map<string, string>();
  for (const item of items) {
    if (!unique.has(item.url)) unique.set(item.url, item.title);
  }

  let bookmarks = safeJsonParse<BookmarksFile>(await fs.readFile(bookmarksPath, 'utf8'), {
    version: 1,
    roots: {},
  });
  if (!bookmarks.roots) bookmarks.roots = {};
  if (!bookmarks.roots.other) {
    bookmarks.roots.other = {
      children: [],
      type: 'folder',
      name: 'Other Bookmarks',
      date_added: chromeTimeNow(),
      date_modified: chromeTimeNow(),
    };
  }
  bookmarks.roots.other.children ??= [];

  const existing = new Set<string>();
  Object.values(bookmarks.roots).forEach((r) => collectUrls(r, existing));

  const folder: BookmarkNode = {
    type: 'folder',
    name: 'Imported from Arc Sidebar',
    guid: makeGuid(),
    date_added: chromeTimeNow(),
    date_modified: chromeTimeNow(),
    children: [],
  };

  let added = 0;
  for (const [url, title] of unique) {
    if (existing.has(url)) continue;
    folder.children!.push({
      type: 'url',
      name: title,
      url,
      guid: makeGuid(),
      date_added: chromeTimeNow(),
      date_modified: chromeTimeNow(),
    });
    existing.add(url);
    added++;
  }

  bookmarks.roots.other.children = bookmarks.roots.other.children.filter(
    (c) => c.name !== 'Imported from Arc Sidebar',
  );
  bookmarks.roots.other.children.push(folder);
  bookmarks.roots.other.date_modified = chromeTimeNow();

  await fs.writeFile(bookmarksPath, JSON.stringify(bookmarks), 'utf8');
  warnings.push(
    `Imported ${added} Arc sidebar favorites into "Other Bookmarks → Imported from Arc Sidebar"`,
  );
  return added;
}

export class BookmarksMigrator extends BaseMigrator {
  readonly stage = 'bookmarks' as const;
  readonly label = 'Migrating bookmarks';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    let found = 0;
    let raw: string | null = null;
    const enableSidebar = ctx.sourceBrowser.enrichments.includes('arc-sidebar');

    if (await fs.pathExists(ctx.source.bookmarks)) {
      raw = await fs.readFile(ctx.source.bookmarks, 'utf8');
      const data = safeJsonParse<BookmarksFile>(raw, {});
      found = Object.values(data.roots ?? {}).reduce((acc, root) => acc + countUrls(root), 0);
    } else {
      warnings.push(`No Bookmarks file in ${ctx.sourceBrowser.displayName} profile`);
    }

    const sidebarCount = enableSidebar ? await countSidebarFavorites(ctx.source.path) : 0;
    found += sidebarCount;

    if (ctx.dryRun) {
      if (sidebarCount > 0) {
        warnings.push(`${sidebarCount} Arc sidebar favorites would be imported as bookmarks`);
      }
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings,
        errors,
        details: { dryRun: true, chromiumBookmarks: found - sidebarCount, sidebar: sidebarCount },
      };
    }

    await fs.ensureDir(ctx.target.path);

    if (raw) {
      await fs.writeFile(ctx.target.bookmarks, raw, 'utf8');
      const bak = ctx.source.bookmarks + '.bak';
      if (await fs.pathExists(bak)) {
        await fs.copy(bak, ctx.target.bookmarks + '.bak', { overwrite: true });
      }
    } else {
      await fs.writeFile(
        ctx.target.bookmarks,
        JSON.stringify({
          checksum: '',
          version: 1,
          roots: {
            bookmark_bar: {
              children: [],
              type: 'folder',
              name: 'Bookmarks Bar',
              date_added: chromeTimeNow(),
              date_modified: chromeTimeNow(),
            },
            other: {
              children: [],
              type: 'folder',
              name: 'Other Bookmarks',
              date_added: chromeTimeNow(),
              date_modified: chromeTimeNow(),
            },
            synced: {
              children: [],
              type: 'folder',
              name: 'Mobile Bookmarks',
              date_added: chromeTimeNow(),
              date_modified: chromeTimeNow(),
            },
          },
        }),
        'utf8',
      );
    }

    const sidebarAdded = enableSidebar
      ? await mergeArcSidebarIntoBookmarks(ctx.target.bookmarks, ctx.source.path, warnings)
      : 0;

    const destRaw = await fs.readFile(ctx.target.bookmarks, 'utf8');
    const destData = safeJsonParse<BookmarksFile>(destRaw, {});
    const transferred = Object.values(destData.roots ?? {}).reduce(
      (acc, root) => acc + countUrls(root),
      0,
    );

    return {
      itemsFound: found,
      itemsTransferred: transferred,
      itemsSkipped: 0,
      itemsFailed: 0,
      warnings,
      errors,
      details: {
        chromiumBookmarks: transferred - sidebarAdded,
        sidebarImported: sidebarAdded,
      },
    };
  }
}
