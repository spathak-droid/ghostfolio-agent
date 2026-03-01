<div style="font-size: 0.75em; line-height: 1.4;">

# Ghostfolio Agent — Cost Analysis

**Cost per query:** ~$0.0018 · **LLM calls:** 3.5 avg · **Keyword bypass:** 60% · **Cache hit:** 25% → 18% savings

## Multi-Model Architecture & LLM Calls

| Tier | Use | Primary Model | Fallback | Cache | Cost/1M | Example Cost |
|------|-----|---------------|----------|-------|---------|--------|
| **Routing** (60%) | Tool selection | gpt-4.1-mini | gpt-4o-mini / nano | 120s | $0.15/$0.60 | 1.5 calls = $0.0010 |
| **Synthesis** (40%) | Polish response | Gemini 2.5 Flash | – | – | $0.075/$0.30 | 2.0 calls = $0.0015 |

**Fallback chain:** Routing (gpt-4.1-mini → gpt-4o-mini → gpt-4o-nano) · Synthesis (Gemini 2.5 Flash → gpt-4o-mini) — timeout 25s

**Tool cache:** 15s TTL (Redis), configurable via `AGENT_TOOL_CACHE_TTL_MS`

## Production Costs (Monthly)

| Users | Queries | LLM API | OpenRouter (7%) | Infrastructure | **Total** | **$/User** |
|-------|---------|---------|---|---|---|---|
| **100** | 6.6K | $11.88 | $0.83 | $5 (Railway hobby) | **$18** | **$0.18** |
| **1K** | 66K | $118.80 | $8.31 | $15 (Railway std) | **$142** | **$0.14** |
| **10K** | 660K | $1,188 | $83 | $75 (Railway + Redis) | **$1,346** | **$0.13** |
| **100K** | 6.6M | $11,880 | $831 | $250 (Railway Pro + Redis) | **$12,961** | **$0.13** |

**Assumptions:** 3 queries/user/day × 22 days = 66 queries/user/mo; ~$0.0018/query (gpt-4.1-mini routing + Gemini 2.5 synthesis + 25% cache hit)

## Cost Optimization (Env Variables)

| Strategy | Variable | Default | Impact | Scenario |
|----------|----------|---------|--------|----------|
| **Extend cache** | `AGENT_TOOL_CACHE_TTL_MS` | 15s | 30s = **-10%** cost | High throughput SaaS |
| **Rate limit** | `AGENT_CHAT_RATE_LIMIT_MAX` | 60/min | Reduce = **-5-15%** | Cost-sensitive |
| **Tier selection** | Model config | Gemini primary | Force fast tier = **-40%** | Non-profit |
| **Context window** | `AGENT_CONTEXT_SUMMARY_SAMPLE_MESSAGES` | 6 | Reduce to 3 = **-8%** tokens | Budget mode |
| **Session TTL** | `AGENT_CONVERSATION_TTL_MS` | 1 hr | 10 min = **-12%** state | Batch processing |

**Example:** Cost-sensitive setup (40% savings at 1K users): `$142 → $85/month`

## Development & Testing (3 Months)

| Activity | Calls | Cost | Total |
|----------|-------|------|-------|
| Local dev (5 devs × 20 queries/day × 30 days) | 3,000 | $0.0018 | $5.40 |
| PR tests (10/week × 50 queries) | 500 | $0.0018 | $0.90 |
| Eval suite **mock** (2× weekly) | 148 | $0 | $0 |
| Eval suite **real** (1× weekly) | 74 | $0.0018 | $0.13 |
| Staging tests + benchmarking | 2,500 | $0.0018 | $4.50 |
| OpenRouter markup (7%) | – | – | $0.77 |
| **3-Month Total** | | | **~$12** |

## Agent vs. Direct LLM

| Query | Direct LLM | Agent Routing | **Savings** |
|-------|-----------|---------------|-----------|
| "Apple's price?" | 6K tokens (~$0.01) | Keyword match (~$0) | **100%** |
| "Portfolio status?" | 8K tokens (~$0.012) | 4.5K tokens (~$0.008) | **33%** |
| "Trade safe?" | 10K tokens (~$0.015) | 6K tokens (~$0.010) | **33%** |
| **Blended/query** | **~$0.012** | **~$0.0018** | **~85%** |

**Why:** 60% keyword pre-filter (zero cost), 40% routed to gpt-4.1-mini, cheap Gemini synthesis

## ROI

- **User lifetime value:** $50–$500
- **LLM cost per user/month:** $0.13–$0.18
- **ROI:** **278×–3,846×**
- **Payback:** <1 day per user

Even if costs **2× more:** ROI still **139×–1,923×**

## Deployment Cost Summary

| Scale | LLM + Markup | Infrastructure | Monitoring | **Total/Mo** | **Per User** |
|-------|---|---|---|---|---|
| **MVP** (<100) | $12.71 | $5 (Hobby) | $0 | **$18** | $0.18 |
| **Standard** (1-10K) | $127.11 | $20 (Std + Redis) | $10 | **$157** | $0.016 |
| **Enterprise** (100K+) | $12,711 | $125 (Pro + Redis) | $100 | **$12,936** | $0.129 |

## Future Cost Trends

| Period | Driver | Expected Change | Impact |
|--------|--------|-----------------|--------|
| **6-12 mo** | Gemini competition | Gemini Flash: $0.10 → $0.05–0.075/1M | **–25% cost** |
| **12-24 mo** | OSS viability | Self-hosted routing + OpenAI fallback | **–40% cost** |
| **24+ mo** | AI standardization | Per-tool pricing models | TBD but likely <50% current |

</div>
