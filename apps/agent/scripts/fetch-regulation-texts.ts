#!/usr/bin/env node
/**
 * Fetch regulation text from all topic key_references (IRS/SEC URLs) and store in Postgres.
 * Run after seed-regulation-topics so regulation_topic has rows.
 * Optional: REGULATION_FETCH_TOPIC_IDS=wash-sale,capital-gains to limit topics.
 *
 * Run: npx dotenv-cli -e .env -- ts-node apps/agent/scripts/fetch-regulation-texts.ts
 */
import 'dotenv/config';
import { createRegulationStoreFromEnv } from '../server/stores';
import { fetchRegulationTexts } from '../server/regulation-fetcher';

async function main(): Promise<void> {
  const store = createRegulationStoreFromEnv();
  const topicIdsEnv = process.env.REGULATION_FETCH_TOPIC_IDS?.trim();
  const topicIds = topicIdsEnv ? topicIdsEnv.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const timeoutMs = process.env.REGULATION_FETCH_TIMEOUT_MS
    ? Math.max(5000, parseInt(process.env.REGULATION_FETCH_TIMEOUT_MS, 10) || 25000)
    : undefined;

  const result = await fetchRegulationTexts(store, { topicIds, timeoutMs });

  if (result.errors.length > 0) {
    result.errors.forEach((e) => {
      // eslint-disable-next-line no-console
      console.warn(`[fetch] ${e.topic_id} ${e.url}: ${e.message}`);
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Fetched ${result.fetched} regulation text(s). Errors: ${result.errors.length}`);
  process.exitCode = result.errors.length > 0 ? 1 : 0;
}

main();
