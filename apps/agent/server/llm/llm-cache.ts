import { createKeyv } from '@keyv/redis';

import { logger } from '../utils';

export interface LlmCacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

class RedisLlmCacheStore implements LlmCacheStore {
  private readonly keyv: ReturnType<typeof createKeyv>;
  private readonly namespace: string;

  public constructor({
    namespace,
    redisUrl
  }: {
    namespace: string;
    redisUrl: string;
  }) {
    this.keyv = createKeyv(redisUrl.trim());
    this.namespace = namespace.trim();
  }

  public async get(key: string): Promise<string | undefined> {
    const value: unknown = await this.keyv.get(this.withNamespace(key));
    return typeof value === 'string' ? value : undefined;
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const ttlMs = Math.max(1, Math.floor(ttlSeconds * 1000));
    await this.keyv.set(this.withNamespace(key), value, ttlMs);
  }

  private withNamespace(key: string): string {
    return `${this.namespace}:${key}`;
  }
}

export function createLlmCacheStoreFromEnv({
  enabled,
  namespace = 'agent:llm-cache',
  redisUrl
}: {
  enabled: boolean;
  namespace?: string;
  redisUrl?: string;
}): LlmCacheStore | undefined {
  if (!enabled) {
    return undefined;
  }
  if (!redisUrl?.trim()) {
    logger.warn(
      '[agent.llm-cache] AGENT_LLM_CACHE_ENABLED=true but no Redis URL was provided. Cache disabled.'
    );
    return undefined;
  }

  try {
    return new RedisLlmCacheStore({
      namespace,
      redisUrl
    });
  } catch {
    logger.warn('[agent.llm-cache] Failed to initialize Redis cache store. Cache disabled.');
    return undefined;
  }
}
