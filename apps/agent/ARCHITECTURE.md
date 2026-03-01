<div style="font-size: 0.85em; line-height: 1.5;">

# Ghostfolio Agent Architecture

## Domain & Use Cases

**Domain:** Conversational wealth management — portfolio operations, market analysis, and financial compliance via natural language.

**Use Cases:**
- **Portfolio Insights:** Net worth, allocation, and risk analysis
- **Market Intelligence:** Price lookup, validation, and trend analysis
- **Tax Planning:** Capital gains estimation and filing optimization
- **Regulatory Compliance:** Trade safety checks and constraint validation
- **Transaction Management:** Query history, categorize activities, timeline analysis


## Agent Architecture

**Runtime:** Node.js 22+ · TypeScript · Custom orchestration (no frameworks)

**Pipeline:** 5-stage orchestration with deterministic fallbacks and LLM-assisted routing.

```
┌─────────────────────────────────────────┐
│    HTTP Interface                       │
│   POST /chat (streaming NDJSON)         │
└────────────────┬────────────────────────┘
┌────────────────▼─────────────────────────┐
│  Orchestration (agent.ts)                │
│ [1] Route Decision → tool selection      │
│ [2] Parameter Generation → extract       │
│ [3] Tool Execution → 25s timeout         │
│ [4] Verification → 4 safety checks       │
│ [5] Synthesis → LLM polish + persist     │
└─────────────────┬────────────────────────┘
         ┌────────┼────────┬──────────┐
         ▼        ▼        ▼          ▼
    ┌─────────┐┌──────────┐┌────────┐┌──────────┐
    │16 Tools ││LLM       ││Ghostf. ││Stores    │
    │• Order  ││(OpenAI/  ││API     ││          │
    │• Port   ││OpenRoute)││Client  ││Redis     │
    │• Market ││Timeout   ││(15s)   ││Postgres  │
    │• Tax    ││25s       ││Bearer  ││          │
    │• Compl. │└──────────┘│token   ││          │
    │• Verify │            └────────┘└──────────┘
    │• Trans. │                      
    └─────────┘            
```

### Key Design Decisions
1. **Deterministic-First:** 148 keywords pre-match ~60% of queries (no LLM cost), LLM only for ambiguity
2. **25-Second Timeout:** Hard limit per tool (Promise.race), response guaranteed <30s
3. **Sequential Execution:** Tools run one-by-one with explicit dependencies, simplifies state management
4. **16 Tools by Domain:** Portfolio (3), Market (4), Verification (3), Transactions (3), Tax (1), Order (3)
5. **Multi-Turn Workflows:** State machine for order clarification (pending → awaiting_clarification → idle)

---

## Verification Strategy

**4-layer pipeline applied to every response (cannot be bypassed):**

1. **Structural** — Rejects empty responses, NaN/Infinity, parse errors
2. **Provenance** — Factual tools require `sources[]` and `data_as_of` timestamp
3. **Claim Verification** — LLM cross-checks answer claims against tool results (±2% tolerance)
4. **Domain Constraints** — Blocks deterministic advice, requires actionable compliance guidance

**Output:** `{ confidence: 0.3-0.82, flags: [], isValid: true|false }` returned in every response

---

## Eval Results

**Test Suite:** 74 test cases across 7 evaluation dimensions

| Category | Count | Coverage |
|----------|-------|----------|
| Happy Path | 28 | Portfolio, market, tax, compliance, orders |
| Edge Cases | 16 | Empty input, malformed, missing fields, timeouts |
| Adversarial | 15 | Advice blocks, hallucination, injection detection |
| Multi-Step | 15 | Clarification flows, dependencies, state |

**Dimensions:** Tool selection, execution, correctness, safety, consistency, edge cases, latency

**Run:** `npm run eval:agent` (mock LLM) or `npm run eval:agent:llm` (real LLM)

---

## Observability

**Structured Logging:**
```
[agent.chat] START    → conversationId, userId, message
[agent.chat] ROUTE    → tools selected, latency
[agent.chat] TOOL_RESULT → tool, success, durationMs
[agent.chat] LATENCY  → breakdown: route + exec + synthesis
```

**Streaming Format:**
```
STATUS|{"step":"route","durationMs":100}
STATUS|{"step":"tool.market_data","durationMs":450}
FINAL|{answer:"...", toolCalls:[...], verification:{...}}
```

**Key Metrics:** Tool latency p95 (25s enforced), keyword routing ratio (60% target), verification flags, tool success rates

**Insight:** Real-time tool status streaming critical for UX — users see "Checking market data..." vs blank spinner

---

## Open Source Contribution

**Package:** [`@ghostfolio/agent`](https://www.npmjs.com/package/@ghostfolio/agent) v2.243.1 · AGPL-3.0

**Released:**
- Complete AI agent layer (16 tools + orchestration)
- 4-layer verification pipeline
- Streaming NDJSON responses with real-time tool status
- Full TypeScript with `.d.ts` declarations
- Evaluation framework (74 test cases across 7 dimensions)

**Install:** `npx @ghostfolio/agent` or `npm install -g @ghostfolio/agent && ghostfolio-agent`

**Integration:** Standalone sidecar — any Ghostfolio deployment can add conversational AI without core API changes. Per-user bearer tokens, no credential sharing.

---

## Implementation Stats

| Component | Purpose |
|-----------|---------|
| `agent.ts` (~750 lines) | Main orchestration loop |
| `llm-runtime.ts` (~450 lines) | Route & synthesis decisions |
| `tool-runtime.ts` (370 lines) | Execution with timeout |
| `routing/` (5 modules) | Intent, selection, sanitization |
| `verification/` (4 modules) | 4-layer checks |
| `tools/` (16 + registry) | Tool implementations |
| `clients/` | Ghostfolio, Yahoo, CoinGecko APIs |

**Tests:** 369 unit + integration tests across routing, execution, verification, edge cases

</div>
