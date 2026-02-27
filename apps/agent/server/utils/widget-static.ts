import { resolve } from 'path';

export function resolveWidgetDistPath(
  cwd: string,
  widgetDistPath?: string
): string {
  if (widgetDistPath) {
    return widgetDistPath;
  }

  return resolve(cwd, 'dist/apps/agent/widget');
}

export function resolveWidgetCorsOrigin(widgetCorsOrigin?: string): string {
  return widgetCorsOrigin || '*';
}
