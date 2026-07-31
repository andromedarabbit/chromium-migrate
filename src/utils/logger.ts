import fs from 'fs-extra';
import path from 'node:path';
import winston from 'winston';
import { PATHS } from '../core/constants.js';
import { nowIso, redactSensitive, timestampDir } from './helpers.js';

let logger: winston.Logger | null = null;
let logFilePath: string | null = null;

export function getLogFilePath(): string | null {
  return logFilePath;
}

export async function initLogger(verbose = false): Promise<winston.Logger> {
  await fs.ensureDir(PATHS.logs);
  const fileName = `migration-${timestampDir()}.log`;
  logFilePath = path.join(PATHS.logs, fileName);

  logger = winston.createLogger({
    level: verbose ? 'debug' : 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const safe = redactSensitive(String(message));
        const metaStr = Object.keys(meta).length
          ? ' ' + redactSensitive(JSON.stringify(meta))
          : '';
        return `${timestamp} [${level.toUpperCase()}] ${safe}${metaStr}`;
      }),
    ),
    transports: [
      new winston.transports.File({ filename: logFilePath }),
      new winston.transports.Console({
        level: verbose ? 'debug' : 'warn',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message }) => `${level}: ${redactSensitive(String(message))}`),
        ),
      }),
    ],
  });

  logger.info(`Logger initialized at ${nowIso()}`);
  return logger;
}

export function getLogger(): winston.Logger {
  if (!logger) {
    // Synchronous fallback for early calls
    logger = winston.createLogger({
      level: 'info',
      transports: [new winston.transports.Console({ level: 'warn' })],
    });
  }
  return logger;
}

export function logSql(operation: string, details?: Record<string, unknown>): void {
  getLogger().debug(`SQL: ${operation}`, details ?? {});
}

export function logSkip(item: string, reason: string): void {
  getLogger().warn(`Skipped: ${item} — ${reason}`);
}

export function logStage(stage: string, event: 'start' | 'finish' | 'fail', extra?: string): void {
  const msg = `Stage [${stage}] ${event}${extra ? `: ${extra}` : ''}`;
  if (event === 'fail') getLogger().error(msg);
  else getLogger().info(msg);
}
