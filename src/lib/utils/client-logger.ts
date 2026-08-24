import { formatLogMessage, generateRequestId, LogLevel } from './logger';

class ClientLogger {
  private readonly requestId: string;

  public constructor() {
    this.requestId = generateRequestId();
    this.info('Client session initialized, requestId=' + this.requestId);
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

let clientLoggerInstance: ClientLogger | null = null;

export function getClientLogger(): ClientLogger {
  if (clientLoggerInstance === null) {
    clientLoggerInstance = new ClientLogger();
  }
  return clientLoggerInstance;
}

export { ClientLogger };