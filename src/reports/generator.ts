import fs from 'fs-extra';
import path from 'node:path';
import { PATHS } from '../core/constants.js';
import type { MigrationReport } from '../types/index.js';
import { nowIso, timestampDir } from '../utils/helpers.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdown(report: MigrationReport): string {
  const lines: string[] = [
    `# Migration Report`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| ID | \`${report.id}\` |`,
    `| Version | ${report.version} |`,
    `| Started | ${report.startedAt} |`,
    `| Finished | ${report.finishedAt ?? ''} |`,
    `| Duration | ${report.durationMs ?? 0} ms |`,
    `| Mode | ${report.dryRun ? 'dry-run' : 'migrate'} |`,
    `| Source | ${report.source.browser} / ${report.source.profile} |`,
    `| Target | ${report.target.browser} / ${report.target.profile} |`,
    `| Backup | ${report.backupPath ?? 'n/a'} |`,
    `| Overall | ${report.summary.overall.success ? 'SUCCESS' : 'FAILURES'} |`,
    ``,
    `## Summary`,
    ``,
    `| Category | Found | Transferred | Skipped | Failed |`,
    `| --- | ---: | ---: | ---: | ---: |`,
  ];

  const cats = [
    'bookmarks',
    'passwords',
    'cookies',
    'history',
    'downloads',
    'extensions',
    'autofill',
    'permissions',
    'preferences',
    'sessions',
    'favicons',
  ] as const;

  for (const c of cats) {
    const s = report.summary[c];
    lines.push(
      `| ${c} | ${s.found} | ${s.transferred} | ${s.skipped} | ${s.failed} |`,
    );
  }

  lines.push(``);
  lines.push(`## Stages`);
  lines.push(``);
  for (const stage of report.stages) {
    lines.push(`### ${stage.stage} — ${stage.status}`);
    lines.push(``);
    lines.push(
      `- Items: ${stage.itemsTransferred}/${stage.itemsFound} (skipped ${stage.itemsSkipped}, failed ${stage.itemsFailed})`,
    );
    if (stage.durationMs !== undefined) lines.push(`- Duration: ${stage.durationMs} ms`);
    if (stage.warnings.length) {
      lines.push(`- Warnings:`);
      for (const w of stage.warnings) lines.push(`  - ${w}`);
    }
    if (stage.errors.length) {
      lines.push(`- Errors:`);
      for (const e of stage.errors) lines.push(`  - ${e}`);
    }
    lines.push(``);
  }

  if (report.failures.length) {
    lines.push(`## Failures`);
    lines.push(``);
    for (const f of report.failures) lines.push(`- ${f}`);
    lines.push(``);
  }

  if (report.warnings.length) {
    lines.push(`## Warnings`);
    lines.push(``);
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  if (report.skippedItems.length) {
    lines.push(`## Skipped Items`);
    lines.push(``);
    for (const s of report.skippedItems) lines.push(`- ${s}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`Generated ${nowIso()} by chromium-migrate`);
  return lines.join('\n');
}

export function renderHtml(report: MigrationReport): string {
  const mdish = renderMarkdown(report);
  const rows = (
    [
      'bookmarks',
      'passwords',
      'cookies',
      'history',
      'downloads',
      'extensions',
      'autofill',
      'permissions',
      'preferences',
      'sessions',
      'favicons',
    ] as const
  )
    .map((c) => {
      const s = report.summary[c];
      return `<tr><td>${c}</td><td>${s.found}</td><td>${s.transferred}</td><td>${s.skipped}</td><td>${s.failed}</td></tr>`;
    })
    .join('\n');

  const stageBlocks = report.stages
    .map(
      (s) => `
    <section>
      <h3>${escapeHtml(s.stage)} <span class="badge ${s.status}">${s.status}</span></h3>
      <p>${s.itemsTransferred}/${s.itemsFound} transferred · ${s.durationMs ?? 0} ms</p>
      ${s.warnings.length ? `<ul class="warn">${s.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
      ${s.errors.length ? `<ul class="err">${s.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''}
    </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Migration Report ${escapeHtml(report.id)}</title>
<style>
  :root { color-scheme: light; --bg:#f7f5f1; --ink:#1a1a1a; --accent:#fb542b; --ok:#1b7f4e; --warn:#9a6b00; --err:#b00020; }
  body { font-family: "SF Pro Text", "Segoe UI", sans-serif; margin:0; background:var(--bg); color:var(--ink); }
  main { max-width: 900px; margin: 2rem auto; padding: 0 1.25rem 3rem; }
  h1 { font-size: 1.75rem; margin-bottom: .25rem; }
  .meta { color:#555; margin-bottom: 1.5rem; }
  .status { display:inline-block; padding:.2rem .6rem; border-radius:4px; font-weight:600; }
  .status.ok { background:#d8f5e5; color:var(--ok); }
  .status.bad { background:#fde2e7; color:var(--err); }
  table { width:100%; border-collapse: collapse; background:#fff; margin:1rem 0 2rem; }
  th, td { text-align:left; padding:.65rem .75rem; border-bottom:1px solid #e6e2db; }
  th { background:#efebe4; font-size:.85rem; text-transform:uppercase; letter-spacing:.04em; }
  .badge { font-size:.75rem; padding:.15rem .45rem; border-radius:3px; background:#eee; }
  .badge.success { background:#d8f5e5; color:var(--ok); }
  .badge.partial { background:#fff3cd; color:var(--warn); }
  .badge.failed { background:#fde2e7; color:var(--err); }
  .warn { color:var(--warn); } .err { color:var(--err); }
  footer { margin-top:2rem; color:#777; font-size:.85rem; }
</style>
</head>
<body>
<main>
  <h1>Migration Report</h1>
  <p class="meta">${escapeHtml(report.source.browser)} → ${escapeHtml(report.target.browser)} · ${escapeHtml(report.id)}</p>
  <p>
    <span class="status ${report.summary.overall.success ? 'ok' : 'bad'}">
      ${report.summary.overall.success ? 'SUCCESS' : 'COMPLETED WITH FAILURES'}
    </span>
    · ${report.durationMs ?? 0} ms · ${report.dryRun ? 'dry-run' : 'migrate'}
  </p>
  <table>
    <thead><tr><th>Category</th><th>Found</th><th>Transferred</th><th>Skipped</th><th>Failed</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Stages</h2>
  ${stageBlocks}
  ${
    report.failures.length
      ? `<h2>Failures</h2><ul class="err">${report.failures.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
      : ''
  }
  ${
    report.warnings.length
      ? `<h2>Warnings</h2><ul class="warn">${report.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
      : ''
  }
  <footer>Generated ${escapeHtml(nowIso())} by chromium-migrate<br/><pre style="display:none">${escapeHtml(mdish)}</pre></footer>
</main>
</body>
</html>`;
}

export async function generateReports(
  report: MigrationReport,
  formats: Array<'json' | 'markdown' | 'html'> = ['json', 'markdown', 'html'],
): Promise<string[]> {
  await fs.ensureDir(PATHS.reports);
  const base = `migration-${timestampDir()}-${report.id}`;
  const paths: string[] = [];

  if (formats.includes('json')) {
    const p = path.join(PATHS.reports, `${base}.json`);
    await fs.writeJson(p, report, { spaces: 2 });
    paths.push(p);
  }
  if (formats.includes('markdown')) {
    const p = path.join(PATHS.reports, `${base}.md`);
    await fs.writeFile(p, renderMarkdown(report), 'utf8');
    paths.push(p);
  }
  if (formats.includes('html')) {
    const p = path.join(PATHS.reports, `${base}.html`);
    await fs.writeFile(p, renderHtml(report), 'utf8');
    paths.push(p);
  }

  return paths;
}

export async function listReports(): Promise<string[]> {
  await fs.ensureDir(PATHS.reports);
  const files = await fs.readdir(PATHS.reports);
  return files
    .filter((f) => f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.html'))
    .sort()
    .reverse();
}
