export async function withEvalLogFilter<T>(
  run: () => Promise<T>,
  options: { suppressNonEvalLogs: boolean }
): Promise<T> {
  if (!options.suppressNonEvalLogs) {
    return run();
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const allow = (args: unknown[]) => typeof args[0] === 'string' && args[0].startsWith('[eval]');

  console.log = (...args: unknown[]) => {
    if (allow(args)) {
      originalLog(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    if (allow(args)) {
      originalWarn(...args);
    }
  };
  console.error = (...args: unknown[]) => {
    if (allow(args)) {
      originalError(...args);
    }
  };

  try {
    return await run();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export function colorizeStatus(status: string, passed: boolean): string {
  const green = '\u001b[32m';
  const red = '\u001b[31m';
  const reset = '\u001b[0m';
  return `${passed ? green : red}${status}${reset}`;
}
