export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function getBeijingTimestamp(): string {
  const now = new Date();
  const beijingOffsetMinutes = 8 * 60;
  const localOffsetMinutes = now.getTimezoneOffset();
  const beijingTime = new Date(now.getTime() + (beijingOffsetMinutes + localOffsetMinutes) * 60 * 1000);

  const year = beijingTime.getFullYear();
  const month = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getDate()).padStart(2, '0');
  const hours = String(beijingTime.getHours()).padStart(2, '0');
  const minutes = String(beijingTime.getMinutes()).padStart(2, '0');
  const seconds = String(beijingTime.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatLogMessage(
  level: LogLevel,
  requestId: string,
  message: string
): string {
  return `[${getBeijingTimestamp()}][${level}][${requestId}] ${message}`;
}

export function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const randomValue = (Math.random() * 16) | 0;
      const value = character === 'x' ? randomValue : (randomValue & 0x3) | 0x8;
      return value.toString(16);
    });
  }
}