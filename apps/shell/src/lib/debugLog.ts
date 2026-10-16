export type LogLevel = 'info' | 'warn' | 'error';

export type LogEntry = {
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
};

const MAX_ENTRIES = 200;
let entries: LogEntry[] = [];
const listeners = new Set<() => void>();

export function pushLog(level: LogLevel, source: string, message: string, data?: unknown): void {
  entries = [...entries, { ts: Date.now(), level, source, message, data }].slice(-MAX_ENTRIES);
  listeners.forEach((listener) => listener());
}

export function getLogSnapshot(): LogEntry[] {
  return entries;
}

export function subscribeToLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
