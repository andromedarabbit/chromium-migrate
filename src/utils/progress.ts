import chalk from 'chalk';
import cliProgress from 'cli-progress';
import ora, { type Ora } from 'ora';
import type { MigrationStage, ProgressUpdate } from '../types/index.js';
import { formatDuration } from './helpers.js';

export class ProgressUI {
  private spinner: Ora | null = null;
  private bar: cliProgress.SingleBar | null = null;
  private startTime = Date.now();
  private quiet: boolean;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  start(message: string): void {
    if (this.quiet) return;
    this.startTime = Date.now();
    this.spinner = ora({ text: message, color: 'cyan' }).start();
  }

  updateSpinner(message: string): void {
    if (this.quiet || !this.spinner) return;
    this.spinner.text = message;
  }

  succeed(message: string): void {
    if (this.quiet) return;
    if (this.spinner) {
      this.spinner.succeed(chalk.green(message));
      this.spinner = null;
    } else {
      console.log(chalk.green('✔'), message);
    }
  }

  fail(message: string): void {
    if (this.quiet) return;
    if (this.spinner) {
      this.spinner.fail(chalk.red(message));
      this.spinner = null;
    } else {
      console.log(chalk.red('✖'), message);
    }
  }

  warn(message: string): void {
    if (this.quiet) return;
    if (this.spinner) {
      this.spinner.warn(chalk.yellow(message));
      this.spinner = null;
    } else {
      console.log(chalk.yellow('⚠'), message);
    }
  }

  info(message: string): void {
    if (this.quiet) return;
    console.log(chalk.blue('ℹ'), message);
  }

  heading(title: string): void {
    if (this.quiet) return;
    console.log();
    console.log(chalk.bold.magenta(`━━ ${title} ━━`));
  }

  startBar(total: number, stage: MigrationStage): void {
    if (this.quiet) return;
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
    this.bar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan('{stage}') +
          ' |' +
          chalk.green('{bar}') +
          '| {percentage}% | {value}/{total} | ETA: {eta_formatted} | {message}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic,
    );
    this.bar.start(total, 0, { stage, message: 'starting…' });
  }

  updateBar(current: number, message?: string): void {
    if (this.quiet || !this.bar) return;
    this.bar.update(current, { message: message ?? '' });
  }

  stopBar(): void {
    if (this.quiet || !this.bar) return;
    this.bar.stop();
    this.bar = null;
  }

  applyUpdate(update: ProgressUpdate): void {
    if (this.quiet) return;
    if (!this.bar) {
      this.startBar(update.total || 100, update.stage);
    }
    this.updateBar(update.current, update.message);
  }

  elapsed(): string {
    return formatDuration(Date.now() - this.startTime);
  }

  table(rows: Array<[string, string]>): void {
    if (this.quiet) return;
    const maxLabel = Math.max(...rows.map(([l]) => l.length), 8);
    for (const [label, value] of rows) {
      console.log(`  ${chalk.dim(label.padEnd(maxLabel))}  ${value}`);
    }
  }

  summaryBox(title: string, lines: string[]): void {
    if (this.quiet) return;
    const width = Math.max(title.length, ...lines.map((l) => l.length), 40) + 4;
    const border = '─'.repeat(width);
    console.log();
    console.log(chalk.bold(`┌${border}┐`));
    console.log(chalk.bold(`│ ${title.padEnd(width - 1)}│`));
    console.log(chalk.dim(`├${border}┤`));
    for (const line of lines) {
      console.log(`│ ${line.padEnd(width - 1)}│`);
    }
    console.log(chalk.bold(`└${border}┘`));
  }
}
