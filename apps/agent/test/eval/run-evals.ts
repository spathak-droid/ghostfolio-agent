import { readFileSync } from 'node:fs';

import { runEvalCases } from '../../server/eval/eval-runner';

async function main() {
  const raw = readFileSync('apps/agent/test/eval/cases.json', 'utf8');
  const cases = JSON.parse(raw) as Parameters<typeof runEvalCases>[0];

  const summary = await runEvalCases(cases);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

void main();
