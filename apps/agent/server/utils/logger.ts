/**
 * Purpose: Centralized logging for the agent server. Output is gated by AGENT_LOG_LEVEL
 * so production can run without debug noise and without writing to debug paths.
 * Inputs: log level env AGENT_LOG_LEVEL: 'debug' | 'info' | 'warn' | 'silent' (default: 'info' when NODE_ENV !== 'production', else 'silent').
 * Outputs: writes to console when level is enabled.
 * Failure modes: none; ignores logging failures.
 */

const LEVEL = (process.env.AGENT_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'silent' : 'info'))
  .toLowerCase()
  .trim();
const DEBUG = LEVEL === 'debug';
const INFO = DEBUG || LEVEL === 'info';
const WARN = INFO || LEVEL === 'warn';

export const logger = {
  debug(...args: unknown[]): void {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  },
  info(...args: unknown[]): void {
    if (INFO) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  },
  warn(...args: unknown[]): void {
    if (WARN) {
      // eslint-disable-next-line no-console
      console.warn(...args);
    }
  },
  error(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
};
