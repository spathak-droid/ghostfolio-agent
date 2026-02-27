# LangSmith Integration for Agent Evaluations

This guide explains how to use LangSmith for tracking and pushing evaluation results, with OpenRouter as the LLM backend.

## Overview

The evaluation system now includes:
- **LangSmith Integration**: Push evaluation results and traces to LangSmith
- **OpenRouter Wrapper**: Use OpenRouter API for LLM-based evaluation scoring
- **Structured Eval Output**: Formatted results for both display and logging

## Setup

### 1. Configure Environment Variables

Add to your `.env` file:

```bash
# LangSmith Configuration
LANGSMITH_API_KEY=<your-langsmith-api-key>
LANGSMITH_PROJECT=ghostfolio-agent
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_TRACING=true

# OpenRouter Configuration (for LLM-based evaluation)
OPENROUTER_API_KEY=<your-openrouter-api-key>
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
```

### 2. Generate LangSmith API Key

1. Go to [LangSmith Dashboard](https://smith.langchain.com)
2. Create account/login
3. Go to Settings → API Keys
4. Create a new key
5. Copy and paste into `.env`

### 3. Setup OpenRouter API Key

1. Go to [OpenRouter](https://openrouter.ai)
2. Sign up/login
3. Go to Keys → Create Key
4. Copy and paste into `.env`

## Running Evaluations with LangSmith

### Basic Evaluation Run

```bash
npm run eval:agent
```

This will:
1. Run all evaluation cases from `cases.json`
2. Display results in the console
3. **Automatically push to LangSmith** if configured
4. Show formatted summary with per-dimension results

### Output

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
```

### LangSmith Push

When `LANGSMITH_API_KEY` is configured, each evaluation run is:
- ✅ Logged to LangSmith with timestamp
- ✅ Includes metrics (pass rate, per-dimension breakdown)
- ✅ Visible in LangSmith dashboard
- ✅ Traceable with OpenRouter API calls

## Using OpenRouter for Eval Scoring

For more advanced evaluations, use OpenRouter to score case results:

```typescript
import {
  scoreEvalCaseWithOpenRouter,
  createOpenRouterConfigFromEnv,
  isOpenRouterConfigured
} from '../server/eval/eval-openrouter';

// In your eval check logic:
if (isOpenRouterConfigured()) {
  const config = createOpenRouterConfigFromEnv();
  const { score, reasoning } = await scoreEvalCaseWithOpenRouter(
    config!,
    testCase.id,
    testCase.query,
    testCase.expectedOutput || [],
    response.answer
  );

  // Use score in your evaluation
}
```

## LangSmith Configuration Details

### Project Structure

Evals are organized in LangSmith as:
- **Project**: `ghostfolio-agent` (default)
- **Run name**: `ghostfolio-agent-eval-{date}-{timestamp}`
- **Metrics**:
  - Total, passed, failed counts
  - Overall pass rate
  - Per-dimension breakdown (tool_execution, answer_quality, etc.)

### Accessing Results

1. Go to [LangSmith Projects](https://smith.langchain.com/projects)
2. Select `ghostfolio-agent` project
3. View evaluation runs with timestamps
4. Click on any run to see detailed metrics
5. Compare multiple runs to track improvements

## API Integration

### Push Eval Results Manually

```typescript
import {
  pushEvalResultsToLangSmith,
  createLangSmithConfigFromEnv
} from '../server/eval/eval-langsmith';
import { runEvalCases } from '../server/eval/eval-runner';

const summary = await runEvalCases(cases);

// Push to LangSmith
const config = createLangSmithConfigFromEnv();
if (config) {
  await pushEvalResultsToLangSmith(config, summary, 'my-custom-run-name');
}
```

### Score with OpenRouter

```typescript
import {
  evaluateWithOpenRouter,
  createOpenRouterConfigFromEnv
} from '../server/eval/eval-openrouter';

const config = createOpenRouterConfigFromEnv();
const evaluation = await evaluateWithOpenRouter(
  config!,
  'Please evaluate this response...'
);
```

## Debugging

Enable debug output:

```bash
DEBUG_LANGSMITH=true npm run eval:agent
```

This will:
- Print eval feedback structure
- Show OpenRouter API calls
- Display LangSmith push details

## Troubleshooting

### LangSmith Not Pushing

**Problem**: Results not appearing in LangSmith dashboard

**Solutions**:
1. Verify `LANGSMITH_API_KEY` is set: `echo $LANGSMITH_API_KEY`
2. Check endpoint is correct: `https://api.smith.langchain.com`
3. Verify project name: `LANGSMITH_PROJECT=ghostfolio-agent`
4. Enable debug: `DEBUG_LANGSMITH=true`

### OpenRouter API Errors

**Problem**: "OpenRouter API error: 401"

**Solutions**:
1. Verify `OPENROUTER_API_KEY` is correct
2. Check it's not expired: go to OpenRouter settings
3. Verify model name: `OPENROUTER_MODEL=openai/gpt-4o-mini`

### Rate Limiting

If hitting rate limits:
- Add exponential backoff (implemented in wrapper)
- Reduce evaluation cases
- Use smaller models (gpt-3.5-turbo)

## Performance

### Typical Run Times

- 10 cases: ~10-15 seconds
- 24 cases: ~25-35 seconds
- 100 cases: ~2-3 minutes

Times vary based on:
- Number of evaluation cases
- LLM response times
- Network latency to LangSmith

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Run Agent Evaluations
  run: npm run eval:agent
  env:
    LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

## Best Practices

1. **Run regularly**: Schedule evals after model updates
2. **Compare runs**: Track improvements over time
3. **Set gates**: Use `gatePassed` to enforce minimum quality
4. **Monitor metrics**: Watch per-dimension pass rates
5. **Archive results**: Keep LangSmith project as audit trail

## See Also

- [LangSmith Documentation](https://docs.smith.langchain.com)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [Evaluation Cases](./eval-cases.md)
- [Evaluation Types](./eval-types.md)
