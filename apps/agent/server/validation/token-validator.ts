import {
  IMPERSONATION_ID_PATTERN,
  JWT_PATTERN,
  MAX_IMPERSONATION_ID_LENGTH,
  MAX_TOKEN_LENGTH
} from './common';

export function validateTokenLength(
  token: string | undefined
): { ok: true } | { ok: false; status: 400; error: string } {
  if (!token) return { ok: true };

  if (/[^\x21-\x7E]/.test(token)) {
    return {
      ok: false,
      status: 400,
      error: 'Token contains invalid characters.'
    };
  }

  if (token.length > MAX_TOKEN_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Token must be at most ${MAX_TOKEN_LENGTH} characters.`
    };
  }

  if (!JWT_PATTERN.test(token)) {
    return {
      ok: false,
      status: 400,
      error: 'Token must be a JWT (header.payload.signature).'
    };
  }

  return { ok: true };
}

export function validateImpersonationId(
  impersonationId: string | undefined
): { ok: true; value?: string } | { ok: false; status: 400; error: string } {
  if (!impersonationId) return { ok: true };

  const trimmed = impersonationId.trim();
  if (!trimmed) return { ok: true };

  if (trimmed.length > MAX_IMPERSONATION_ID_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `impersonation-id must be at most ${MAX_IMPERSONATION_ID_LENGTH} characters.`
    };
  }

  if (!IMPERSONATION_ID_PATTERN.test(trimmed)) {
    return {
      ok: false,
      status: 400,
      error: 'impersonation-id contains invalid characters.'
    };
  }

  return { ok: true, value: trimmed };
}
