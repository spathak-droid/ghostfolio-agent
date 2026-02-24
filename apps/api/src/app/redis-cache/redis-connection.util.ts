import type { RedisOptions } from 'ioredis';

type RedisEnvironment = {
  REDIS_DB: number;
  REDIS_HOST: string;
  REDIS_PASSWORD: string;
  REDIS_PORT: number;
  REDIS_URL: string;
};

export function buildRedisStoreUrl(environment: RedisEnvironment): string {
  if (environment.REDIS_URL) {
    return environment.REDIS_URL;
  }

  const redisPassword = encodeURIComponent(environment.REDIS_PASSWORD);

  return `redis://${redisPassword ? `:${redisPassword}` : ''}@${environment.REDIS_HOST}:${environment.REDIS_PORT}/${environment.REDIS_DB}`;
}

export function getBullRedisConfig(
  environment: RedisEnvironment
): RedisOptions {
  if (environment.REDIS_URL) {
    const redisUrl = new URL(environment.REDIS_URL);
    const db = redisUrl.pathname ? parseInt(redisUrl.pathname.slice(1), 10) : 0;

    return {
      db: Number.isNaN(db) ? 0 : db,
      host: redisUrl.hostname,
      password: decodeURIComponent(redisUrl.password),
      port: redisUrl.port ? parseInt(redisUrl.port, 10) : 6379,
      tls: redisUrl.protocol === 'rediss:' ? {} : undefined
    };
  }

  return {
    db: environment.REDIS_DB,
    host: environment.REDIS_HOST,
    password: environment.REDIS_PASSWORD,
    port: environment.REDIS_PORT
  };
}
