import { resolveGhostfolioBaseUrl } from '../../server/ghostfolio-base-url';

describe('resolveGhostfolioBaseUrl', () => {
  it('uses configured base URL when provided', () => {
    const result =
      resolveGhostfolioBaseUrl({
        configuredBaseUrl: 'https://ghostfolio.example.com',
        fallbackBaseUrl: 'http://localhost:3333'
      });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://ghostfolio.example.com');
  });

  it('falls back to static base URL when configured value is missing', () => {
    const result =
      resolveGhostfolioBaseUrl({
        fallbackBaseUrl: 'http://localhost:3333'
      });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('http://localhost:3333');
  });

  it('falls back to static base URL when configured value is blank', () => {
    const result =
      resolveGhostfolioBaseUrl({
        configuredBaseUrl: '   ',
        fallbackBaseUrl: 'http://localhost:3333'
      });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('http://localhost:3333');
  });

  it('rejects invalid URL', () => {
    const result = resolveGhostfolioBaseUrl({
      configuredBaseUrl: ':/not-a-url',
      fallbackBaseUrl: 'http://localhost:3333'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('invalid URL');
  });

  it('rejects non-https remote URL by default', () => {
    const result = resolveGhostfolioBaseUrl({
      configuredBaseUrl: 'http://ghostfolio.example.com',
      fallbackBaseUrl: 'http://localhost:3333'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('HTTPS');
  });

  it('accepts allowlisted host only when allowlist is configured', () => {
    const result = resolveGhostfolioBaseUrl({
      configuredBaseUrl: 'https://ghostfolio.example.com',
      fallbackBaseUrl: 'http://localhost:3333',
      allowedHosts: ['ghostfolio.example.com']
    });
    expect(result.ok).toBe(true);
  });

  it('rejects host outside allowlist', () => {
    const result = resolveGhostfolioBaseUrl({
      configuredBaseUrl: 'https://evil.example.com',
      fallbackBaseUrl: 'http://localhost:3333',
      allowedHosts: ['ghostfolio.example.com']
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('allowlist');
  });
});
