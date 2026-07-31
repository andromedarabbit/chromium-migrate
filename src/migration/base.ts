import type { BrowserInfo, MigrationStage, StageResult } from '../types/index.js';
import type { ProfilePaths } from '../types/index.js';
import { nowIso } from '../utils/helpers.js';
import { logStage } from '../utils/logger.js';
import type { ProgressUI } from '../utils/progress.js';

export interface MigratorContext {
  source: ProfilePaths;
  target: ProfilePaths;
  sourceBrowser: BrowserInfo;
  targetBrowser: BrowserInfo;
  dryRun: boolean;
  ui: ProgressUI;
  sourceSafeKey?: Buffer;
  targetSafeKey?: Buffer;
}

export abstract class BaseMigrator {
  abstract readonly stage: MigrationStage;
  abstract readonly label: string;

  async run(ctx: MigratorContext): Promise<StageResult> {
    const startedAt = nowIso();
    const startMs = Date.now();
    logStage(this.stage, 'start');
    ctx.ui.start(`${this.label}…`);

    const result: StageResult = {
      stage: this.stage,
      status: 'running',
      startedAt,
      itemsFound: 0,
      itemsTransferred: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      warnings: [],
      errors: [],
    };

    try {
      const outcome = await this.migrate(ctx);
      Object.assign(result, outcome);
      result.status =
        result.itemsFailed > 0 && result.itemsTransferred > 0
          ? 'partial'
          : result.itemsFailed > 0 && result.itemsTransferred === 0
            ? 'failed'
            : 'success';
      result.finishedAt = nowIso();
      result.durationMs = Date.now() - startMs;

      if (result.status === 'failed') {
        ctx.ui.fail(`${this.label} failed`);
        logStage(this.stage, 'fail', result.errors.join('; '));
      } else {
        ctx.ui.succeed(
          `${this.label}: ${result.itemsTransferred}/${result.itemsFound} transferred` +
            (result.itemsSkipped ? ` (${result.itemsSkipped} skipped)` : ''),
        );
        logStage(this.stage, 'finish', `status=${result.status}`);
      }
    } catch (err) {
      result.status = 'failed';
      result.errors.push(String(err));
      result.finishedAt = nowIso();
      result.durationMs = Date.now() - startMs;
      ctx.ui.fail(`${this.label}: ${String(err)}`);
      logStage(this.stage, 'fail', String(err));
    }

    return result;
  }

  protected abstract migrate(ctx: MigratorContext): Promise<Partial<StageResult>>;
}
