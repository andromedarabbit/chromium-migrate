import chalk from 'chalk';
import { APP_NAME, APP_VERSION } from '../types/index.js';

/** Brand colors aligned with assets/logo.png & assets/banner.png */
export const BRAND = {
  cyan: chalk.hex('#00D1FF'),
  purple: chalk.hex('#A855F7'),
  muted: chalk.hex('#94A3B8'),
  white: chalk.white,
} as const;

/**
 * Compact splash shown on bare `chromium-migrate` / `--help`.
 * Uses ANSI color only — no image dependency in the terminal.
 */
export function printSplash(stream: NodeJS.WritableStream = process.stderr): void {
  const title =
    BRAND.white.bold('chromium') + BRAND.purple.bold('-migrate') + BRAND.muted(`  v${APP_VERSION}`);
  const tagline = BRAND.muted('Migrate Chromium profiles · Chrome · Brave · Arc · Edge · Vivaldi · …');
  const bar = BRAND.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  stream.write(`\n${bar}\n  ${title}\n  ${tagline}\n${bar}\n\n`);
}

export function brandDescription(): string {
  return (
    chalk.bold('Migrate Chromium browser profiles between browsers') +
    BRAND.muted(' (Chrome, Brave, Arc, Edge, Vivaldi, …)')
  );
}

export function helpFooter(browserList: string): string {
  return [
    '',
    BRAND.cyan('Docs') + BRAND.muted('  https://github.com/IshankDev/chromium-migrate'),
    BRAND.cyan('Logo') + BRAND.muted('  assets/logo.png'),
    '',
    BRAND.white('Supported browsers:'),
    `  ${BRAND.muted(browserList)}`,
    '',
    BRAND.muted(`Examples:`),
    BRAND.muted(`  ${APP_NAME} migrate --from chrome --to brave -y`),
    BRAND.muted(`  ${APP_NAME} dry-run --from arc --to edge`),
    BRAND.muted(`  ${APP_NAME} profiles`),
    '',
  ].join('\n');
}
