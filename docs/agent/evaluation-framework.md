# Agent Evaluation Framework

## Purpose
Run production-style evaluations across seven dimensions:

- Correctness
- Tool Selection
- Tool Execution
- Safety
- Consistency
- Edge Cases
- Latency

## Files

- `apps/agent/server/eval/eval-runner.ts`
- `apps/agent/server/eval/default-eval-cases.ts`
- `apps/agent/server/eval/run-default-evals.ts`

## Run

```bash
npx nx run agent:eval
```

The command prints JSON summary and exits with non-zero status if the eval gate fails.

## Eval Case Schema

Each case defines:

- `id`
- `input`
- `dimensions[]`
- `expectation`:
  - tool expectations (`expectedPrimaryTool`, `expectedTools`, `expectedToolCountAtLeast`)
  - output expectations (`mustContain`, `mustNotContain`, `groundTruthContains`)
  - verification expectations (`expectedFlags`, `expectedValidity`)
  - robustness checks (`repeatRuns`, `latencyMsMax`)
  - execution checks (`requireSuccessfulToolCalls`, `requiredToolInputFields`)

## Gate

Default gate checks:

- Overall pass rate threshold
- Optional per-dimension minimum pass rates

Use stricter thresholds in CI for production rollout.

## CI

- **Build code** (`.github/workflows/build-code.yml`): runs on every PR; includes a "Run agent evals" step after tests (fixture LLM/tools, no secrets).
- **Agent** (`.github/workflows/agent.yml`): runs on PRs when `apps/agent/**` or `libs/**` change, and on push to `main`/`dev`. Runs agent lint, agent unit tests, and agent evals. No OpenAI or live Ghostfolio required; evals use fixture LLM and eval tools.
