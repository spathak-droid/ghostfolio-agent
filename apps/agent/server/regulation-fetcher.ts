/**
 * Purpose: Fetch regulation page content from IRS/SEC URLs and store in Postgres.
 * Inputs: RegulationStore (from env), optional topicIds filter and fetch timeout.
 * Outputs: Counts of fetched/updated and per-URL errors.
 * Failure modes: non-HTML or failed fetch → skip and log; store failure → return error.
 */

import * as cheerio from 'cheerio';

import type { RegulationStore } from './stores';

const DEFAULT_FETCH_TIMEOUT_MS = 25_000;
const USER_AGENT =
  'Ghostfolio-Agent-RegulationFetcher/1.0 (compliance; +https://ghostfol.io)';

export interface FetchRegulationTextsResult {
  fetched: number;
  errors: { url: string; topic_id: string; message: string }[];
}

/**
 * Fetch a single URL and return plain text. Prefers HTML and extracts body text; non-HTML is skipped.
 */
export async function fetchUrlAsText(
  url: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<{ text: string } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }

  if (!response.ok) {
    return { error: `HTTP ${response.status}` };
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    return { error: `Unsupported content-type: ${contentType.split(';')[0].trim()}` };
  }

  const html = await response.text();
  if (contentType.includes('text/plain')) {
    return { text: html.trim() };
  }

  try {
    const $ = cheerio.load(html);
    $('script, style, nav, footer, [role="navigation"]').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return { text: text || $('html').text().replace(/\s+/g, ' ').trim() };
  } catch {
    return { error: 'Failed to parse HTML' };
  }
}

/**
 * For each topic, fetch each key_reference URL and insert/update regulation_text.
 * Idempotent: re-run overwrites existing content for the same (topic_id, source_url).
 */
export async function fetchRegulationTexts(
  store: RegulationStore,
  options: {
    topicIds?: string[];
    timeoutMs?: number;
  } = {}
): Promise<FetchRegulationTextsResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const topics = await store.listTopics();
  const filter = new Set(options.topicIds?.map((id) => id.trim()).filter(Boolean));
  const toProcess = filter.size > 0 ? topics.filter((t) => filter.has(t.id)) : topics;

  const result: FetchRegulationTextsResult = { fetched: 0, errors: [] };
  const seen = new Set<string>();

  for (const topic of toProcess) {
    for (const sourceUrl of topic.key_references) {
      if (!sourceUrl || typeof sourceUrl !== 'string') continue;
      const url = sourceUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
      const key = `${topic.id}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fetched = await fetchUrlAsText(url, timeoutMs);
      if ('error' in fetched) {
        result.errors.push({ url, topic_id: topic.id, message: fetched.error });
        continue;
      }

      const inserted = await store.insertRegulationText({
        topic_id: topic.id,
        source_url: url,
        content: fetched.text.slice(0, 1_000_000)
      });
      if ('error' in inserted) {
        result.errors.push({ url, topic_id: topic.id, message: inserted.error });
        continue;
      }
      result.fetched += 1;
    }
  }

  return result;
}
