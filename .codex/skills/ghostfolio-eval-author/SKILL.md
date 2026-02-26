# ghostfolio-eval-author

Use this skill when adding or modifying agent tools in Ghostfolio.

## Purpose
Keep evals aligned with tool registry changes and enforce deterministic, regression-safe eval coverage.

## Required behavior
1. Detect tool additions/changes by reading:
- `apps/agent/server/tools/tool-registry.ts`
- `apps/agent/server/types.ts`

2. Update eval dataset in:
- `apps/agent/server/eval/default-eval-cases.ts`

3. For every tool, ensure at least **3 evals per tool** (minimum), and prefer this pattern:
- happy path
- edge case
- adversarial/prompt-injection
- multi-step workflow

4. Enforce global dataset minimums:
- total >= 50
- happy_path >= 20
- edge_case >= 10
- adversarial >= 10
- multi_step >= 10

5. Every eval case must contain:
- `inputQuery`
- `expectedToolCalls`
- `expectedOutput`
- `passFailCriteria`

6. Keep assertions deterministic:
- avoid brittle exact phrasing unless from stable tool summary fields
- prefer tool execution + expected payload fragments

## Validation workflow
Run:
- `npx jest --config apps/agent/jest.config.ts --runInBand apps/agent/test/unit/eval-runner.spec.ts`
- `npx ts-node apps/agent/server/eval/run-default-evals.ts`

## Done criteria
- eval runner unit tests pass
- default eval suite passes gate
- tool coverage and category thresholds are satisfied
