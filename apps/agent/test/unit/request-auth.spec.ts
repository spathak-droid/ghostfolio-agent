import { resolveRequestToken } from '../../server/request-auth';

describe('resolveRequestToken', () => {
  it('uses Authorization header token when present', () => {
    const result = resolveRequestToken({
      authorizationHeader: 'Bearer a.b.c',
      allowBodyAccessToken: false,
      bodyAccessToken: undefined
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token).toBe('a.b.c');
  });

  it('rejects body token when body token mode is disabled', () => {
    const result = resolveRequestToken({
      authorizationHeader: undefined,
      allowBodyAccessToken: false,
      bodyAccessToken: 'a.b.c'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { error: string }).error).toContain(
        'accessToken in request body is disabled'
      );
    }
  });

  it('accepts body token when enabled and header missing', () => {
    const result = resolveRequestToken({
      authorizationHeader: undefined,
      allowBodyAccessToken: true,
      bodyAccessToken: 'a.b.c'
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token).toBe('a.b.c');
  });

  it('rejects mismatched header/body tokens', () => {
    const result = resolveRequestToken({
      authorizationHeader: 'Bearer a.b.c',
      allowBodyAccessToken: true,
      bodyAccessToken: 'x.y.z'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result as { error: string }).error).toContain('mismatch');
  });
});
