import { describe, it, expect } from 'vitest';
import type { MigrationReport } from '../../src/types/index.js';
import { renderMarkdown, renderHtml } from '../../src/reports/generator.js';

const sample: MigrationReport = {
  id: 'abc123',
  version: '1.0.0',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:01:00.000Z',
  durationMs: 60000,
  source: { browser: 'Arc', browserId: 'arc', profile: 'Default', path: '/tmp/arc' },
  target: { browser: 'Brave', browserId: 'brave', profile: 'Default', path: '/tmp/brave' },
  dryRun: false,
  stages: [
    {
      stage: 'bookmarks',
      status: 'success',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:10.000Z',
      durationMs: 10000,
      itemsFound: 10,
      itemsTransferred: 10,
      itemsSkipped: 0,
      itemsFailed: 0,
      warnings: [],
      errors: [],
    },
  ],
  summary: {
    bookmarks: { found: 10, transferred: 10, skipped: 0, failed: 0 },
    passwords: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    cookies: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    history: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    downloads: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    extensions: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    autofill: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    permissions: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    preferences: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    sessions: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    favicons: { found: 0, transferred: 0, skipped: 0, failed: 0 },
    overall: {
      success: true,
      stagesSucceeded: 1,
      stagesFailed: 0,
      stagesSkipped: 0,
      totalItemsFound: 10,
      totalItemsTransferred: 10,
    },
  },
  failures: [],
  warnings: ['sample warning'],
  skippedItems: [],
};

describe('reports', () => {
  it('renders markdown', () => {
    const md = renderMarkdown(sample);
    expect(md).toContain('# Migration Report');
    expect(md).toContain('bookmarks');
    expect(md).toContain('sample warning');
  });

  it('renders html', () => {
    const html = renderHtml(sample);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('SUCCESS');
    expect(html).toContain('bookmarks');
  });
});
