/**
 * Crash handlers: Global error handlers for production stability.
 * Ensures unhandled rejections and exceptions are logged before exit.
 */

import { logger } from './utils';

/**
 * Install process-level crash handlers so production stays up and failures are visible in logs.
 * Unhandled rejections are logged and do not exit; uncaught exceptions log and exit after a short delay.
 */
export function installCrashHandlers(): void {
  process.on('unhandledRejection', (reason, promise) => {
    // eslint-disable-next-line no-console
    console.error('[agent] UNHANDLED_REJECTION', { reason, promise: String(promise) });
    logger.error('[agent] UNHANDLED_REJECTION', { reason, promise: String(promise) });
  });

  process.on('uncaughtException', (error) => {
    // eslint-disable-next-line no-console
    console.error('[agent] UNCAUGHT_EXCEPTION', error?.message ?? String(error), error?.stack ?? '');
    logger.error('[agent] UNCAUGHT_EXCEPTION', error?.message ?? String(error), error?.stack ?? '');
    // Allow logs to flush, then exit so the process manager can restart.
    setTimeout(() => process.exit(1), 1000);
  });
}
