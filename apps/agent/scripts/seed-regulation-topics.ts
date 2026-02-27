#!/usr/bin/env node
/**
 * One-time seed of the 10 IRS/SEC regulation topics into Postgres.
 * Uses same DB as feedback (AGENT_FEEDBACK_DATABASE_URL or DATABASE_URL or AGENT_REGULATION_DATABASE_URL).
 * Run: npx dotenv-cli -e .env -- ts-node apps/agent/scripts/seed-regulation-topics.ts
 */
import 'dotenv/config';
import { createRegulationStoreFromEnv } from '../server/regulation-store';

async function main(): Promise<void> {
  const store = createRegulationStoreFromEnv();
  const result = await store.seedTopics();
  if (result.error) {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', result.error);
    process.exitCode = 1;
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${result.seeded} regulation topics.`);
}

main();
