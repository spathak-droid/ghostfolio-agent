import { normalizeAuthToken } from '../../server/auth';

describe('normalizeAuthToken', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeAuthToken(undefined)).toBeUndefined();
    expect(normalizeAuthToken('')).toBeUndefined();
    expect(normalizeAuthToken('   ')).toBeUndefined();
  });

  it('keeps raw jwt tokens unchanged', () => {
    expect(normalizeAuthToken('abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('strips single Bearer prefix case-insensitively', () => {
    expect(normalizeAuthToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(normalizeAuthToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('strips repeated Bearer prefixes', () => {
    expect(normalizeAuthToken('Bearer Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(normalizeAuthToken(' bearer   bearer   abc.def.ghi ')).toBe(
      'abc.def.ghi'
    );
  });
});
