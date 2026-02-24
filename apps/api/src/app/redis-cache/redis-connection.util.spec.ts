import {
  buildRedisStoreUrl,
  getBullRedisConfig
} from './redis-connection.util';

describe('redis-connection.util', () => {
  it('prefers REDIS_URL for cache store', () => {
    const redisUrl = 'rediss://default:secret@railway.example:6380/0';

    expect(
      buildRedisStoreUrl({
        REDIS_DB: 0,
        REDIS_HOST: 'localhost',
        REDIS_PASSWORD: '',
        REDIS_PORT: 6379,
        REDIS_URL: redisUrl
      })
    ).toBe(redisUrl);
  });

  it('builds cache store URL from split env vars', () => {
    expect(
      buildRedisStoreUrl({
        REDIS_DB: 1,
        REDIS_HOST: 'localhost',
        REDIS_PASSWORD: 'p@ss word',
        REDIS_PORT: 6379,
        REDIS_URL: ''
      })
    ).toBe('redis://:p%40ss%20word@localhost:6379/1');
  });

  it('parses REDIS_URL into Bull redis config', () => {
    expect(
      getBullRedisConfig({
        REDIS_DB: 0,
        REDIS_HOST: 'localhost',
        REDIS_PASSWORD: '',
        REDIS_PORT: 6379,
        REDIS_URL: 'rediss://default:secret@railway.example:6380/3'
      })
    ).toEqual({
      db: 3,
      host: 'railway.example',
      password: 'secret',
      port: 6380,
      tls: {}
    });
  });
});
