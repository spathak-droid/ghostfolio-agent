/**
 * Purpose: Normalize authorization header/token input to a raw JWT string.
 * Inputs: optional value that may include Bearer prefixes or whitespace.
 * Outputs: raw token string or undefined when input is empty/invalid.
 * Failure modes: malformed inputs return undefined to avoid forwarding junk credentials.
 */
export function normalizeAuthToken(input?: string) {
  if (!input) {
    return undefined;
  }

  let token = input.trim();
  if (!token) {
    return undefined;
  }

  // Handle repeated prefixes and case variants: "Bearer <jwt>", "bearer Bearer <jwt>".
  while (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, '').trim();
  }

  return token || undefined;
}
