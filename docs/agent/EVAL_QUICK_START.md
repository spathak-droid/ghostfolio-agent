# Evaluation + LangSmith Quick Start

## 1-Minute Setup

```bash
# 1. Add to .env
LANGSMITH_API_KEY=<your-key-from-smith.langchain.com>
LANGSMITH_PROJECT=ghostfolio-agent
OPENROUTER_API_KEY=<your-key-from-openrouter.ai>
OPENROUTER_MODEL=openai/gpt-4o-mini

# 2. Run evals
npm run eval:agent

# 3. View results in LangSmith dashboard
# https://smith.langchain.com/projects/ghostfolio-agent
```

## Commands

```bash
# Run evaluations and push to LangSmith
npm run eval:agent

# Run with debug logging
DEBUG_LANGSMITH=true npm run eval:agent

# Run with verbose case output
npm run eval:agent -- --verbose
```

## Architecture

```
run-evals.ts (entry point)
    ↓
eval-runner.ts (execute cases)
    ↓
eval-checks.ts (validate results)
    ↓
eval-langsmith.ts (push to LangSmith) ← LANGSMITH_API_KEY
    ↓
eval-openrouter.ts (optional LLM scoring) ← OPENROUTER_API_KEY
    ↓
LangSmith Dashboard
```

## Key Files

| File | Purpose |
|------|---------|
| `eval-langsmith.ts` | Push results to LangSmith |
| `eval-openrouter.ts` | Score evals with OpenRouter LLM |
| `run-evals.ts` | Entry point - orchestrates everything |
| `eval-runner.ts` | Runs test cases against agent |
| `eval-checks.ts` | Validates responses |

## Environment Variables

```bash
# Required for LangSmith Push
LANGSMITH_API_KEY=ls_abc123...
LANGSMITH_PROJECT=ghostfolio-agent
LANGSMITH_ENDPOINT=https://api.smith.langchain.com

# Optional for LLM-based Scoring
OPENROUTER_API_KEY=sk-or-abc123...
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions

# Optional for Debugging
DEBUG_LANGSMITH=true
```

## Getting API Keys

### LangSmith
1. Go to [smith.langchain.com](https://smith.langchain.com)
2. Sign up (free)
3. Settings → API Keys → Create Key
4. Copy key to `.env` as `LANGSMITH_API_KEY`

### OpenRouter
1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up (free with credits)
3. Keys → Create Key
4. Copy key to `.env` as `OPENROUTER_API_KEY`

## Output

```
[eval] Running evaluation cases...

Evaluation Results
==================
Total cases: 24
Passed: 22
Failed: 2
Pass rate: 91.7%
Gate passed: ✓

Per-dimension results:
  tool_execution: 100.0% (10/10)
  answer_quality: 85.0% (8/10)
  compliance_check: 87.5% (7/8)

[langsmith] ✓ Pushed eval results to LangSmith project: ghostfolio-agent
```

## Viewing Results in LangSmith

1. Go to [smith.langchain.com/projects](https://smith.langchain.com/projects)
2. Select "ghostfolio-agent"
3. View recent runs with metrics
4. Click any run to see detailed results

## Troubleshooting

**LangSmith key not working?**
```bash
echo $LANGSMITH_API_KEY  # Should print your key
```

**OpenRouter key not working?**
```bash
echo $OPENROUTER_API_KEY  # Should print your key
```

**Want to skip LangSmith push?**
- Just unset `LANGSMITH_API_KEY` - evals still run, just don't push

**Want to enable debug?**
```bash
DEBUG_LANGSMITH=true npm run eval:agent
```

## Next Steps

- Read full guide: [`eval-langsmith-integration.md`](./eval-langsmith-integration.md)
- Edit test cases: [`apps/agent/test/eval/cases.json`](../../apps/agent/test/eval/cases.json)
- Add new checks: [`eval-checks.ts`](../../apps/agent/server/eval/eval-checks.ts)

## Architecture Overview

```
Agent Evaluator
├── Input: Test cases (query, expected tools, expected output)
├── Execute: Run agent with test queries
├── Validate: Check against criteria
├── Score: Per-dimension evaluation
├── Push: Send to LangSmith
└── Output: Console + JSON + LangSmith
```

The evaluation system is **completely optional** - if you don't set LangSmith/OpenRouter keys, evals still run and display results locally.
