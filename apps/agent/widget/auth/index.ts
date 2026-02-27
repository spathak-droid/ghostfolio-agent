import {
  AUTH_TOKEN_STORAGE_KEY,
  IMPERSONATION_STORAGE_KEY
} from '../utils/constants';

export function getAuthToken(): string | null {
  try {
    return (
      window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ||
      window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function setAuthToken(token: string, persist = false): void {
  try {
    window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    if (persist) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // ignore
  }
}

export function clearAuthToken(): void {
  try {
    window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getImpersonationId(): string | null {
  try {
    return window.localStorage.getItem(IMPERSONATION_STORAGE_KEY);
  } catch {
    return null;
  }
}
