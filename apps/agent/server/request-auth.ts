import { normalizeAuthToken } from './auth-token';

type ResolveRequestTokenResult =
  | {
      ok: true;
      token?: string;
    }
  | {
      ok: false;
      status: 400;
      error: string;
    };

/**
 * Resolve request token from header/body with strict precedence and mismatch checks.
 */
export function resolveRequestToken({
  authorizationHeader,
  allowBodyAccessToken,
  bodyAccessToken
}: {
  authorizationHeader?: string;
  allowBodyAccessToken: boolean;
  bodyAccessToken?: string;
}): ResolveRequestTokenResult {
  const headerToken = normalizeAuthToken(authorizationHeader);
  const bodyToken = normalizeAuthToken(bodyAccessToken);

  if (headerToken && bodyToken && headerToken !== bodyToken) {
    return {
      ok: false,
      status: 400,
      error: 'Authorization header token and body accessToken mismatch.'
    };
  }

  if (headerToken) {
    return { ok: true, token: headerToken };
  }

  if (bodyToken) {
    if (!allowBodyAccessToken) {
      return {
        ok: false,
        status: 400,
        error:
          'accessToken in request body is disabled. Use Authorization: Bearer <token>.'
      };
    }

    return { ok: true, token: bodyToken };
  }

  return { ok: true, token: undefined };
}
