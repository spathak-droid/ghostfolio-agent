/**
 * Purpose: Resolve Ghostfolio API base URL for agent->API requests.
 * Inputs: configured env base URL and static fallback URL.
 * Outputs: validated base URL.
 * Failure modes: invalid URL, non-HTTPS remote URL, or host outside allowlist.
 */
export function resolveGhostfolioBaseUrl({
  configuredBaseUrl,
  fallbackBaseUrl,
  allowedHosts,
  allowInsecureHttp = false
}: {
  configuredBaseUrl?: string;
  fallbackBaseUrl: string;
  allowedHosts?: string[];
  allowInsecureHttp?: boolean;
}):
  | { ok: true; url: string }
  | { ok: false; error: string; status: 500 } {
  const selected = configuredBaseUrl?.trim() || fallbackBaseUrl;

  let parsed: URL;
  try {
    parsed = new URL(selected);
  } catch {
    return {
      ok: false,
      status: 500,
      error: 'Ghostfolio base URL is invalid URL.'
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1';

  if (parsed.protocol !== 'https:' && !isLocalHost && !allowInsecureHttp) {
    return {
      ok: false,
      status: 500,
      error: 'Ghostfolio base URL must use HTTPS for non-local hosts.'
    };
  }

  if (allowedHosts && allowedHosts.length > 0) {
    const normalizedAllowedHosts = allowedHosts
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (!normalizedAllowedHosts.includes(hostname)) {
      return {
        ok: false,
        status: 500,
        error: 'Ghostfolio base URL host is not in allowlist.'
      };
    }
  }

  return { ok: true, url: parsed.toString().replace(/\/+$/, '') };
}
