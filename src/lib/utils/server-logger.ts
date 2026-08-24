import { NextRequest } from 'next/server';
import { formatLogMessage, generateRequestId, LogLevel } from './logger';

export class ServerLogger {
  private readonly requestId: string;

  public constructor(requestId: string) {
    this.requestId = requestId;
  }

  public getRequestId(): string {
    return this.requestId;
  }

  public debug(message: string): void {
    const formatted = formatLogMessage('DEBUG', this.requestId, message);
    console.debug(formatted);
  }

  public info(message: string): void {
    const formatted = formatLogMessage('INFO', this.requestId, message);
    console.info(formatted);
  }

  public warn(message: string): void {
    const formatted = formatLogMessage('WARN', this.requestId, message);
    console.warn(formatted);
  }

  public error(message: string): void {
    const formatted = formatLogMessage('ERROR', this.requestId, message);
    console.error(formatted);
  }
}

export function createServerLogger(request: NextRequest): ServerLogger {
  const requestId = request.headers.get('x-request-id') ?? generateRequestId();
  return new ServerLogger(requestId);
}