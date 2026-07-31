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
<title>Migration Report ${escapeHtml(report.id)} · chromium-migrate</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #070b14;
    --panel: #0f172a;
    --ink: #e2e8f0;
    --muted: #94a3b8;
    --cyan: #00d1ff;
    --purple: #a855f7;
    --ok: #34d399;
    --warn: #fbbf24;
    --err: #f87171;
    --line: #1e293b;
  }
  body { font-family: "SF Pro Text", "Segoe UI", system-ui, sans-serif; margin:0; background:
    radial-gradient(1200px 600px at 10% -10%, rgba(0,209,255,.12), transparent),
    radial-gradient(900px 500px at 90% 0%, rgba(168,85,247,.14), transparent),
    var(--bg); color:var(--ink); }
  main { max-width: 920px; margin: 2rem auto; padding: 0 1.25rem 3rem; }
  .brand { display:flex; align-items:center; gap:.75rem; margin-bottom: 1.25rem; }
  .brand img { width:40px; height:40px; border-radius:10px; }
  .brand span { font-weight:700; letter-spacing:.02em; }
  .brand span em { font-style:normal; color:var(--purple); }
  h1 { font-size: 1.75rem; margin:0 0 .35rem; }
  .meta { color:var(--muted); margin-bottom: 1.5rem; }
  .status { display:inline-block; padding:.25rem .7rem; border-radius:999px; font-weight:600; font-size:.85rem; }
  .status.ok { background:rgba(52,211,153,.15); color:var(--ok); border:1px solid rgba(52,211,153,.35); }
  .status.bad { background:rgba(248,113,113,.12); color:var(--err); border:1px solid rgba(248,113,113,.35); }
  table { width:100%; border-collapse: collapse; background:var(--panel); margin:1rem 0 2rem; border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { text-align:left; padding:.7rem .85rem; border-bottom:1px solid var(--line); }
  th { background:rgba(0,209,255,.06); font-size:.78rem; text-transform:uppercase; letter-spacing:.06em; color:var(--cyan); }
  .badge { font-size:.75rem; padding:.15rem .45rem; border-radius:999px; background:#1e293b; }
  .badge.success { background:rgba(52,211,153,.15); color:var(--ok); }
  .badge.partial { background:rgba(251,191,36,.12); color:var(--warn); }
  .badge.failed { background:rgba(248,113,113,.12); color:var(--err); }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:1rem 1.1rem; margin-bottom:.75rem; }
  .warn { color:var(--warn); } .err { color:var(--err); }
  footer { margin-top:2rem; color:var(--muted); font-size:.85rem; }
  a { color:var(--cyan); }
</style>
</head>
<body>
<main>
  <div class="brand">
    <img src="../assets/logo.png" alt="chromium-migrate" onerror="this.style.display='none'" />
    <span>chromium<em>-migrate</em></span>
  </div>
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
  <footer>Generated ${escapeHtml(nowIso())} by <a href="https://github.com/IshankDev/chromium-migrate">chromium-migrate</a><br/><pre style="display:none">${escapeHtml(mdish)}</pre></footer>
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
