import { config } from 'dotenv';
import { readFileSync } from 'node:fs';

// Load environment variables from .env file
config();

import { runEvalCases } from '../../server/eval/eval-runner';
import {
  pushEvalResultsToLangSmith,
  createLangSmithConfigFromEnv,
  formatEvalSummaryForDisplay
} from '../../server/eval/eval-langsmith';

async function main() {
  const raw = readFileSync('apps/agent/test/eval/cases.json', 'utf8');
  const cases = JSON.parse(raw) as Parameters<typeof runEvalCases>[0];

  // eslint-disable-next-line no-console
  console.log('[eval] Running evaluation cases...\n');

  const summary = await runEvalCases(cases);

  // Display results
  // eslint-disable-next-line no-console
  console.log('\n' + formatEvalSummaryForDisplay(summary));

  // Push to LangSmith if configured
  const langSmithConfig = createLangSmithConfigFromEnv();
  if (langSmithConfig) {
    const runName = `ghostfolio-agent-eval-${new Date().toISOString().split('T')[0]}-${Date.now()}`;
    await pushEvalResultsToLangSmith(langSmithConfig, summary, runName);
  } else {
    // eslint-disable-next-line no-console
    console.log('\n[langsmith] Skipped (LANGSMITH_API_KEY not configured)');
  }

  // Also output JSON for programmatic use
  // eslint-disable-next-line no-console
  console.log('\nDetailed results:');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

void main();
