#!/usr/bin/env node
/**
 * One-off script to flush the current Redis database (FLUSHDB).
 * Loads .env from project root. Usage: node scripts/flush-redis.mjs
 * Or with explicit env: npx dotenv-cli -e .env -- node scripts/flush-redis.mjs
 */
import { createClient } from '@redis/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

function getRedisUrl() {
  let url = process.env.REDIS_URL?.trim();
  if (url) {
    if (!/^redis(s)?:\/\//i.test(url)) {
      url = 'redis://' + url.replace(/^\/*/, '');
    }
    try {
      const u = new URL(url);
      // @redis/client only accepts path "/" or "/<number>"; e.g. "/default" causes "Invalid pathname"
      if (u.pathname.length > 1) {
        const dbNum = Number(u.pathname.slice(1));
        if (Number.isNaN(dbNum)) {
          u.pathname = '/0';
          url = u.toString();
        }
      }
      return url;
    } catch {
      url = null;
    }
  }
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || 6379;
  const db = process.env.REDIS_DB ?? 0;
  const password = process.env.REDIS_PASSWORD;
  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  return `redis://${auth}${host}:${port}/${db}`;
}

const redisUrl = getRedisUrl();

async function main() {
  const client = createClient({ url: redisUrl });
  client.on('error', (err) => {
    console.error('Redis error:', err.message);
    process.exitCode = 1;
  });
  await client.connect();
  await client.flushDb();
  console.log('Redis FLUSHDB completed.');
  await client.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
