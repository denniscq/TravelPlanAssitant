import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeStream = require('stream') as typeof import('stream');
const { Writable } = nodeStream;
import winston from 'winston';
import {
  ServerLogger,
  createServerLogger,
  resetWinstonLoggerForTests,
  flushServerLoggerForTests,
} from './server-logger';

/**
 * Unit + rotation tests for ServerLogger.
 *
 * Test layers:
 *  1. Pure DI seam — inject a fake winston and assert the formatted message reaches it.
 *  2. Format byte-for-byte preservation — regression guard for the [ts][level][requestId] msg format.
 *  3. Rotation behavior — maxFiles: '7d', filename pattern, LOG_DIR override.
 *  4. Build-time safety — importing the module without calling createServerLogger does not touch fs.
 *  5. Lazy singleton — repeated createServerLogger calls share the same winston instance.
 *
 * Notes:
 *  - Tests that exercise the real daily-rotate-file transport must await
 *    flushServerLoggerForTests() before reading the directory, because
 *    winston writes are async and an immediate readdir can race against
 *    the file open.
 *  - LOG_DIR is reset between tests to keep state isolated.
 */

interface CapturedLog {
  level: string;
  message: string;
}

function createCapturingWinston(): { logger: winston.Logger; captured: CapturedLog[] } {
  const captured: CapturedLog[] = [];
  const writable = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
      try {
        const parsed = JSON.parse(chunk.toString('utf-8'));
        captured.push({ level: String(parsed.level), message: String(parsed.message) });
      } catch {
        captured.push({ level: 'unknown', message: chunk.toString('utf-8') });
      }
      cb();
    },
  });
  const logger = winston.createLogger({
    level: 'debug',
    levels: winston.config.npm.levels,
    format: winston.format.json(),
    transports: [
      new winston.transports.Stream({ stream: writable }),
    ],
  });
  return { logger, captured };
}

describe('ServerLogger DI seam', () => {
  it('forwards info() to the injected winston logger with the formatted message', () => {
    const { logger, captured } = createCapturingWinston();
    const sl = new ServerLogger('req-abc', logger);
    sl.info('hello world');
    expect(captured.length).toBe(1);
    expect(captured[0]?.level).toBe('info');
    expect(captured[0]?.message).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\[INFO\]\[req-abc\] hello world$/);
  });

  it('forwards debug(), warn(), and error() to the injected winston logger', () => {
    const { logger, captured } = createCapturingWinston();
    const sl = new ServerLogger('req-xyz', logger);
    sl.debug('d');
    sl.warn('w');
    sl.error('e');
    expect(captured.length).toBe(3);
    expect(captured.map((c) => c.level)).toEqual(['debug', 'warn', 'error']);
    expect(captured.map((c) => c.message)).toEqual([
      expect.stringMatching(/\[DEBUG\]\[req-xyz\] d$/),
      expect.stringMatching(/\[WARN\]\[req-xyz\] w$/),
      expect.stringMatching(/\[ERROR\]\[req-xyz\] e$/),
    ]);
  });

  it('preserves requestId through getRequestId()', () => {
    const { logger } = createCapturingWinston();
    const sl = new ServerLogger('req-keep', logger);
    expect(sl.getRequestId()).toBe('req-keep');
  });
});

describe('ServerLogger format byte-for-byte preservation', () => {
  it('matches the format produced by the pre-change console implementation', () => {
    const { logger, captured } = createCapturingWinston();
    const sl = new ServerLogger('req-fmt', logger);
    sl.info('District tree loaded - root=3 provinces');
    const line = captured[0]?.message ?? '';
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\[INFO\]\[req-fmt\] District tree loaded - root=3 provinces$/);
    const headerEnd = line.indexOf('] District tree loaded');
    expect(headerEnd).toBeGreaterThan(0);
    const header = line.substring(0, headerEnd + 1);
    const opens = (header.match(/\[/g) ?? []).length;
    const closes = (header.match(/\]/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe('Winston singleton behavior', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slogger-singleton-'));
    process.env.LOG_DIR = tmpDir;
    resetWinstonLoggerForTests();
  });

  afterEach(async () => {
    await flushServerLoggerForTests();
    delete process.env.LOG_DIR;
    resetWinstonLoggerForTests();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns loggers backed by the same winston singleton (one file across calls)', async () => {
    const fakeRequest = new Request('http://localhost/test', { headers: { 'x-request-id': 'a' } }) as unknown as import('next/server').NextRequest;
    const a = createServerLogger(fakeRequest);
    const b = createServerLogger(fakeRequest);
    a.info('one');
    b.info('two');
    await flushServerLoggerForTests();
    const files = readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
    const content = readFileSync(join(tmpDir, files[0]!), 'utf-8');
    expect(content).toContain('one');
    expect(content).toContain('two');
  });
});

describe('LOG_DIR configuration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slogger-logdir-'));
  });

  afterEach(async () => {
    await flushServerLoggerForTests();
    delete process.env.LOG_DIR;
    resetWinstonLoggerForTests();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes to LOG_DIR when set', async () => {
    process.env.LOG_DIR = tmpDir;
    resetWinstonLoggerForTests();
    const fakeRequest = new Request('http://localhost/test') as unknown as import('next/server').NextRequest;
    const logger = createServerLogger(fakeRequest);
    logger.info('written-to-logdir');
    await flushServerLoggerForTests();
    expect(existsSync(tmpDir)).toBe(true);
    const files = readdirSync(tmpDir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const content = readFileSync(join(tmpDir, files[0]!), 'utf-8');
    expect(content).toContain('written-to-logdir');
  });

  it('does not throw when LOG_DIR is unset and the logger is created', () => {
    delete process.env.LOG_DIR;
    resetWinstonLoggerForTests();
    const fakeRequest = new Request('http://localhost/test') as unknown as import('next/server').NextRequest;
    expect(() => createServerLogger(fakeRequest)).not.toThrow();
  });
});

describe('Daily rotation transport configuration', () => {
  it('writes to a file named TravelPlanAssistant-YYYY-MM-DD.log under LOG_DIR', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'slogger-rotate-'));
    process.env.LOG_DIR = tmpDir;
    resetWinstonLoggerForTests();

    const fakeRequest = new Request('http://localhost/test') as unknown as import('next/server').NextRequest;
    const logger = createServerLogger(fakeRequest);
    logger.info('rotation-probe');
    await flushServerLoggerForTests();

    const files = readdirSync(tmpDir);
    const logFiles = files.filter((f) => f.startsWith('TravelPlanAssistant-') && f.endsWith('.log'));
    expect(logFiles.length).toBeGreaterThanOrEqual(1);
    expect(logFiles[0]).toMatch(/^TravelPlanAssistant-\d{4}-\d{2}-\d{2}\.log$/);

    delete process.env.LOG_DIR;
    resetWinstonLoggerForTests();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Build-time import safety', () => {
  it('does not create log files when the module is imported but createServerLogger is not called', async () => {
    const probeDir = mkdtempSync(join(tmpdir(), 'slogger-probe-'));
    process.env.LOG_DIR = probeDir;
    resetWinstonLoggerForTests();
    vi.resetModules();
    await import('./server-logger');
    const filesAfterImport = readdirSync(probeDir);
    expect(filesAfterImport.filter((f) => f.endsWith('.log')).length).toBe(0);
    delete process.env.LOG_DIR;
    resetWinstonLoggerForTests();
    rmSync(probeDir, { recursive: true, force: true });
  });
});
