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
