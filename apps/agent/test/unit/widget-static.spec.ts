import {
  resolveWidgetCorsOrigin,
  resolveWidgetDistPath
} from '../../server/utils';

describe('widget static assets', () => {
  it('uses default dist path when env override is absent', () => {
    const result = resolveWidgetDistPath('/workspace/repo');

    expect(result).toBe('/workspace/repo/dist/apps/agent/widget');
  });

  it('uses env override path when provided', () => {
    const result = resolveWidgetDistPath('/workspace/repo', '/tmp/widget-build');

    expect(result).toBe('/tmp/widget-build');
  });

  it('uses wildcard cors origin by default', () => {
    const result = resolveWidgetCorsOrigin();

    expect(result).toBe('*');
  });

  it('uses env cors origin override when provided', () => {
    const result = resolveWidgetCorsOrigin('https://localhost:4200');

    expect(result).toBe('https://localhost:4200');
  });
});
