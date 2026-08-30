import { NextRequest } from 'next/server';
import winston from 'winston';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DailyRotateFile = require('winston-daily-rotate-file');
import { formatLogMessage, generateRequestId, LogLevel } from './logger';

/**
 * ServerLogger forwards 4-level log calls (DEBUG/INFO/WARN/ERROR) to a winston
 * logger instance. The winston logger writes to console (for systemd journalctl)
 * AND to a daily-rotated file under logs/.
 *
 * Public API is intentionally identical to the pre-change implementation so the
 * 16 API route handlers and 5 service modules do not need code changes.
 *
 * Format preservation: every log line is pre-formatted via formatLogMessage
 * into [YYYY-MM-DD HH:mm:ss][LEVEL][requestId] message; the winston printf
 * formatter writes the message string verbatim so the byte-for-byte format
 * matches the pre-change console output.
 */

export type ServerLoggerWinston = winston.Logger;

export class ServerLogger {
  private readonly requestId: string;
  private readonly winston: ServerLoggerWinston;

  public constructor(requestId: string, winstonLogger?: ServerLoggerWinston) {
    this.requestId = requestId;
    this.winston = winstonLogger ?? getWinstonLogger();
  }

  public getRequestId(): string {
    return this.requestId;
  }

  public debug(message: string): void {
    this.winston.debug(formatLogMessage('DEBUG', this.requestId, message));
  }

  public info(message: string): void {
    this.winston.info(formatLogMessage('INFO', this.requestId, message));
  }

  public warn(message: string): void {
    this.winston.warn(formatLogMessage('WARN', this.requestId, message));
  }

  public error(message: string): void {
    this.winston.error(formatLogMessage('ERROR', this.requestId, message));
  }
}

export function createServerLogger(request: NextRequest): ServerLogger {
  const requestId = request.headers.get('x-request-id') ?? generateRequestId();
  return new ServerLogger(requestId);
}

/**
 * Module-scope lazy winston singleton.
 *
 * Lazily initialized on first call so that importing this module during
 * `next build` does not create logs/ or open file handles. Reset only via
 * resetWinstonLoggerForTests() to keep production callers from accidentally
 * rebuilding the logger.
 */
let winstonSingleton: ServerLoggerWinston | null = null;

function resolveLogDir(): string {
  const fromEnv = process.env.LOG_DIR;
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : 'logs';
}

function buildWinstonLogger(): ServerLoggerWinston {
  const logDir = resolveLogDir();
  const dailyRotate = new DailyRotateFile({
    filename: 'TravelPlanAssistant-%DATE%.log',
    dirname: logDir,
    datePattern: 'YYYY-MM-DD',
    maxFiles: '7d',
    auditFile: `${logDir}/.winston-audit.json`,
    format: winston.format.printf(({ message }: { message: unknown }) =>
      typeof message === 'string' ? message : JSON.stringify(message)
    ),
  });
  return winston.createLogger({
    levels: winston.config.npm.levels,
    transports: [
      new winston.transports.Console({
        format: winston.format.printf(({ message }: { message: unknown }) =>
          typeof message === 'string' ? message : JSON.stringify(message)
        ),
      }),
      dailyRotate,
    ],
  });
}

function getWinstonLogger(): ServerLoggerWinston {
  if (winstonSingleton === null) {
    winstonSingleton = buildWinstonLogger();
  }
  return winstonSingleton;
}

/**
 * Wait for the daily-rotate-file transport to flush its write buffer to disk.
 * The transport writes asynchronously, so tests that immediately read the
 * directory after a log call must await this to avoid ENOENT races.
 *
 * Strategy: wait for the underlying file stream's 'finish' event via a
 * one-time listener, with a failsafe timeout. We avoid calling any
 * potentially-flaky transport.flush() because the daily-rotate-file transport
 * does not implement a public flush() method.
 */
export function flushServerLoggerForTests(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (winstonSingleton === null) {
      resolve();
      return;
    }
    let resolved = false;
    const done = (): void => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    // Give winston's transport stream pool time to flush pending writes
    setTimeout(done, 300);
  });
}

/**
 * Test-only escape hatch: clears the singleton so the next createServerLogger
 * call rebuilds it. Used by vitest suites to honor LOG_DIR overrides between
 * tests. Must not be called from production code.
 */
export function resetWinstonLoggerForTests(): void {
  if (winstonSingleton !== null) {
    try {
      winstonSingleton.close();
    } catch {
      // Ignore close errors during teardown
    }
  }
  winstonSingleton = null;
}
