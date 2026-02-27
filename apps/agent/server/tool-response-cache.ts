import { createHash } from 'crypto';

import { createKeyv } from '@keyv/redis';

import { logger } from './logger';

export const DEFAULT_TOOL_CACHE_TTL_MS = 15_000;
const DEFAULT_NAMESPACE = 'agent:tool-cache';

export interface ToolResponseCacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

class InMemoryToolResponseCacheStore implements ToolResponseCacheStore {
  private readonly values = new Map<string, { expiresAt: number; value: unknown }>();

  public async get<T>(key: string): Promise<T | undefined> {
    const now = Date.now();
    const item = this.values.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= now) {
      this.values.delete(key);
      return undefined;
    }
    return item.value as T;
  }

  public async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.values.set(key, { expiresAt: Date.now() + Math.max(1, ttlMs), value });
  }
}

class RedisToolResponseCacheStore implements ToolResponseCacheStore {
  private readonly keyv: ReturnType<typeof createKeyv>;
  private readonly namespace: string;

  public constructor({ redisUrl, namespace }: { redisUrl: string; namespace: string }) {
    this.keyv = createKeyv(redisUrl.trim());
    this.namespace = namespace.trim();
  }

  public async get<T>(key: string): Promise<T | undefined> {
    const value: unknown = await this.keyv.get(this.withNamespace(key));
    return value as T | undefined;
  }

  public async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.keyv.set(this.withNamespace(key), value, Math.max(1, ttlMs));
  }

  private withNamespace(key: string): string {
    return `${this.namespace}:${key}`;
  }
}

export function createToolResponseCacheStoreFromEnv({
  namespace = DEFAULT_NAMESPACE,
  redisUrl
}: {
  namespace?: string;
  redisUrl?: string;
}): ToolResponseCacheStore {
  if (!redisUrl?.trim()) {
    return new InMemoryToolResponseCacheStore();
  }

  try {
    return new RedisToolResponseCacheStore({
      namespace,
      redisUrl
    });
  } catch {
    logger.warn('[agent.tool-cache] Failed to initialize Redis cache; using in-memory cache.');
    return new InMemoryToolResponseCacheStore();
  }
}

export function buildToolCacheKey({
  input,
  toolName
}: {
  input: Record<string, unknown>;
  toolName: string;
}): string {
  const normalized = normalizeForKey(input);
  const payload = stableStringify(normalized);
  const digest = createHash('sha256').update(payload).digest('hex');
  return `${toolName}:${digest}`;
}

export async function withToolResponseCache<T extends Record<string, unknown>>({
  cache,
  input,
  task,
  toolName,
  ttlMs = DEFAULT_TOOL_CACHE_TTL_MS
}: {
  cache: ToolResponseCacheStore;
  input: Record<string, unknown>;
  task: () => Promise<T>;
  toolName: string;
  ttlMs?: number;
}): Promise<T> {
  const key = buildToolCacheKey({ input, toolName });
  const cached = await cache.get<T>(key);
  if (cached) {
    return cached;
  }

  const result = await task();
  if (isCacheableResult(result)) {
    await cache.set(key, result, ttlMs);
  }
  return result;
}

function isCacheableResult(value: Record<string, unknown>): boolean {
  if (value.success === false) return false;
  if (typeof value.error === 'string') return false;
  if (typeof value.errorMessage === 'string') return false;
  return true;
}

function normalizeForKey(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'token' && typeof value === 'string') {
      normalized.tokenHash = hashToken(value);
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}
