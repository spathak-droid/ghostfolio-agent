# AI Agent Pre-Search Document

## Project: Ghostfolio Finance Agent

**Challenger:** `Sandesh Pathak`  
**Date:** `February 23, 2026`  
**Project Repo:** `Ghostfolio`  
**Deployment Target:** `Railway`  
**Primary LLM Gateway:** `OpenRouter`  
**Planned Orchestration:** `LangGraph + existing NestJS services`

---

## 1. Executive Summary

This project builds a finance-domain AI agent on top of Ghostfolio's existing architecture. The agent supports portfolio analysis, risk checks, market data interpretation, transaction categorization, and import validation. The design prioritizes verification, traceability, and production reliability.

---

## 2. Key Decisions (At a Glance)

| Category | Decision |
|---|---|
| Domain | Finance (portfolio decision support) |
| Users (initial) | 100 users |
| Confidence threshold | 0.8 |
| Agent architecture | Single-agent with tools |
| Framework | LangGraph (with existing NestJS modules) |
| LLM provider | OpenRouter |
| Hosting | Railway |
| Observability | LangSmith + custom structured logs |
| Evals | 50+ test cases, CI-gated |
| Verification | Fact checking, hallucination detection, confidence scoring, domain constraints, output validation, HITL |

---

## 3. Assumptions Table

| Assumption | Value |
|---|---|
| Queries per user per day | 3-10 |
| Daily query volume (100 users) | 300-1,000 |
| Concurrency target | 10-20 active sessions |
| Single-tool latency target | <5s |
| Multi-step latency target | <15s |
| Tool success rate target | >95% |
| Eval pass threshold | >80% |
| Hallucination target | <5% unsupported claims |
| Verification accuracy target | >90% correct flags |

---

## 4. Phase 1: Define Your Constraints

### 4.1 Domain Selection

- Domain: Finance
- Supported use cases:
1. Portfolio analysis
2. Risk and exposure analysis
3. Market data lookup with explanation
4. Transaction categorization and pattern detection
5. Import/data validation
- Verification requirements:
1. Source-backed claims with timestamp
2. Unsupported claims flagged or blocked
3. Strict permission checks for any user portfolio data
4. Stale data detection and disclosure
- Data sources:
1. Internal portfolio/order/settings/analytics data via Postgres + Prisma
2. Redis cache and snapshots
3. External providers (Yahoo, CoinGecko, and configured adapters)
- Pros:
1. Strong fit with current codebase
2. Clear measurable outcomes
- Cons:
1. Wrong answers can influence financial decisions
2. External data variability impacts consistency

### 4.2 Scale and Performance

- Initial scale: 100 users
- Query estimate: 3-10 queries per user/day (300-1,000 daily)
- Latency targets:
1. Single-tool query: <5s
2. Multi-step chain (3+ tools): <15s
- Concurrency target: 10-20 active sessions
- LLM cost constraints:
1. Token budgets per request
2. Model routing by complexity (cheaper model for simple tasks)
- Pros:
1. Existing Redis + queues reduce load
- Cons:
1. LLM and provider latency can spike under bursts

### 4.3 Reliability Requirements

- Cost of wrong answer:
1. High impact on trust and decision quality in finance context
- Non-negotiable verification:
1. Fact checking
2. Hallucination detection
3. Confidence scoring
4. Domain constraints
5. Output validation
6. Human-in-the-loop escalation
- HITL policy:
1. Escalate when confidence <0.8
2. Escalate on conflicting sources
3. Escalate on high-risk recommendations with weak evidence
- Audit/compliance needs:
1. Full request trace logging
2. Historical storage of eval and verification outcomes

### 4.4 Team and Skill Constraints

- Framework familiarity: moderate with agent frameworks, strong in Node/NestJS
- Domain familiarity: moderate-to-strong in portfolio analytics
- Eval/testing familiarity: strong software testing baseline, formal LLM eval process to be established

---

## 5. Phase 2: Architecture Discovery

### 5.1 Agent Framework Selection

- Framework choice: LangGraph with existing NestJS services
- Architecture: single agent with tool-calling
- State management:
1. Session state in Redis
2. Persistent traces/evals/feedback in Postgres
- Tool integration complexity: medium
- Pros:
1. Deterministic multi-step orchestration
2. Strong control over verification gates
- Cons:
1. Initial integration overhead

### 5.2 LLM Selection

- Primary provider: OpenRouter
- Why OpenRouter:
1. Already aligned with existing implementation
2. Flexible model routing for cost and quality
3. Lower migration risk
- Function calling support: required
- Context window needs: medium-large for tool outputs + verification context
- Cost per query policy:
1. Keep blended cost low via routing and token limits

### 5.3 Tool Design

- Core tools:
1. `portfolio_analysis(userId, filters)`
2. `market_data(symbols, metrics, dateRange)`
3. `transaction_categorize(userId, from, to)`
4. `compliance_check(userId, policySet)`
5. `import_validation(activities[])`
6. `risk_exposure(userId, filters)` (extension)
- External dependencies:
1. Existing market data providers via adapter layer
- Development strategy:
1. Mock/frozen fixtures for deterministic evals
2. Live provider mode for integration/performance checks
- Error handling per tool:
1. Input schema validation
2. Timeout and retry
3. Fallback provider where available
4. Standardized typed errors

### 5.4 Observability Strategy

- Choice: LangSmith + custom structured logging
- Metrics that matter most:
1. End-to-end latency
2. LLM latency
3. Tool execution latency
4. Tool success/failure rate
5. Verification failure rate
6. Hallucination flag rate
7. Token usage and cost per request
8. User feedback signals
- Real-time monitoring:
1. Required for latency spikes, tool failures, and verification anomalies
- Cost tracking:
1. Per request
2. Daily aggregate
3. Feature-level breakdown

### 5.5 Eval Approach

- Correctness measurement:
1. Assertions against expected outputs and citation checks
- Ground truth sources:
1. Internal deterministic portfolio calculations
2. Frozen datasets and expected outputs
- Automated vs human evaluation:
1. Automated for CI regression
2. Human review for ambiguous/high-risk samples
- CI integration:
1. PR smoke evals
2. Full eval suite on merge/nightly
- Eval dataset requirements (minimum 50):
1. 20+ happy path
2. 10+ edge cases
3. 10+ adversarial inputs
4. 10+ multi-step reasoning scenarios
- Each test case includes:
1. Input query
2. Expected tool calls
3. Expected output
4. Pass/fail criteria

### 5.6 Verification Design

- Claims to verify:
1. Prices, returns, allocations, risk metrics, and recommendation claims
- Fact-checking data sources:
1. Cross-reference against authoritative sources: internal ledger + approved market providers
2. Require source metadata and timestamp for each claim
- Confidence threshold:
1. 0.8
- Escalation triggers:
1. Confidence <0.8
2. Missing citation for a material claim
3. Conflicting tool outputs
4. Stale or unavailable source data
5. High-risk recommendation with weak evidence

---

## 6. Phase 3: Post-Stack Refinement

### 6.1 Failure Mode Analysis

- Tool failure behavior:
1. Retry transient failures once
2. Use fallback provider where supported
3. Return partial answer with explicit warning if unresolved
- Ambiguous query handling:
1. Ask clarification when required fields are missing
2. Apply safe defaults only when disclosed
- Rate limiting and fallback:
1. Per-user and per-tool limits
2. Queue non-urgent workloads
3. Prefer cached snapshots under load
- Graceful degradation:
1. Use last-known cached values with freshness warning
2. Fallback to deterministic tool-only summary when LLM is unavailable

### 6.2 Security Considerations

- Prompt injection prevention:
1. Treat retrieved/tool text as untrusted
2. Strict tool allowlist
3. System policy overrides user/tool instructions
- Data leakage prevention:
1. Enforce auth + authorization per tool call
2. Redact sensitive fields in responses/logs
- API key management:
1. Railway environment secrets
2. Key rotation and scoped environments
3. Never expose provider keys to frontend
- Audit logging requirements:
1. Log trace id, inputs, tool path, outputs summary, confidence, citations, timing, tokens, and errors

### 6.3 Testing Strategy

- Unit tests:
1. Tool schemas
2. Parameter validation
3. Verifier and confidence logic
4. Error mapping
- Integration tests:
1. Full agent flow from query to verified response
- Adversarial testing:
1. Prompt injection attempts
2. Policy bypass attempts
3. Malformed payloads
4. Citation spoofing attempts
- Regression setup:
1. Baseline eval snapshots
2. CI gating on score regression

### 6.4 Open Source Planning

- Planned release:
1. Agent module scaffold
2. Tool registry
3. Verification layer
4. Eval runner and dataset template
- Licensing:
1. Keep AGPL-3.0 compatibility
- Documentation:
1. Setup and architecture guide
2. Tool contracts
3. Safety and verification policy
4. Eval runbook
- Community engagement:
1. Labels for `agent`, `eval`, `safety`
2. Contributor instructions for adding tools/evals

### 6.5 Deployment and Operations

- Hosting approach:
1. Railway deployment for app + Postgres + Redis
- CI/CD for agent updates:
1. Build, lint, test, eval-smoke on PR
2. Health-gated deploy from main
- Monitoring and alerting:
1. Alert on latency SLO breaches
2. Alert on tool success-rate drops
3. Alert on verification/hallucination spikes
4. Alert on cost anomalies
- Rollback strategy:
1. Rollback to previous Railway release
2. Feature flags to disable risky agent capabilities quickly

### 6.6 Iteration Planning

- User feedback collection:
1. Thumbs up/down
2. Optional correction text
- Eval-driven improvement cycle:
1. Weekly review of failed evals and production traces
2. Convert recurring failures into new eval cases
- Feature prioritization:
1. Safety
2. Correctness
3. Latency
4. UX improvements
- Long-term maintenance:
1. Monthly model/cost review
2. Quarterly tool reliability review
3. Prompt and policy versioning

---

## 7. Verification Systems (Required - Implement 3+, Planned 6)

1. **Fact Checking**  
Cross-reference claims against authoritative sources (internal ledger + approved market providers), and attach source metadata + timestamps.

2. **Hallucination Detection**  
Flag unsupported claims and require source attribution. If attribution is missing for material claims, block or downgrade response.

3. **Confidence Scoring**  
Quantify certainty using source agreement, data freshness, and output completeness; surface low-confidence responses.

4. **Domain Constraints**  
Enforce finance business rules such as permission boundaries, stale quote thresholds, valid symbols/currencies, and feature/subscription policy constraints.

5. **Output Validation**  
Schema validation, format checking, and completeness validation before returning responses.

6. **Human-in-the-Loop**  
Escalate high-risk decisions when confidence is low, evidence conflicts, or critical claims are weakly supported.

---

## 8. Performance Targets

| Metric | Target |
|---|---|
| End-to-end latency | <5 seconds for single-tool queries |
| Multi-step latency | <15 seconds for 3+ tool chains |
| Tool success rate | >95% successful execution |
| Eval pass rate | >80% on test suite |
| Hallucination rate | <5% unsupported claims |
| Verification accuracy | >90% correct flags |

**Verification accuracy formula:**  
`(correctly flagged + correctly passed) / total verified claims`

---

## 9. Cost Analysis Plan (Required)

### 9.1 Development and Testing Costs (assumption-based estimate)

The values below are planning assumptions for pre-search. Replace them with measured run data during implementation.

- LLM API costs (reasoning/tool/response): `$41.40`
- Total input tokens: `5,400,000`
- Total output tokens: `2,100,000`
- Number of API calls: `3,000`
- Observability tool costs: `$15.00`
- Total development/testing spend: `$56.40`

### 9.2 Production Cost Projections

| Scale | Monthly Cost |
|---|---|
| 100 users | `$264/month` |
| 1,000 users | `$2,639/month` |
| 10,000 users | `$26,393/month` |
| 100,000 users | `$263,925/month` |

### 9.3 Cost Assumptions and Formula

1. Queries per user per day: `5`
2. Average input tokens per query: `1,800`
3. Average output tokens per query: `700`
4. Blended LLM rate (planning): `$3.00 / 1M input tokens`, `$12.00 / 1M output tokens`
5. Non-LLM overhead per query (tool execution, infra, verification): `$0.0015`
6. Verification overhead is included in token and per-query overhead assumptions above
7. Contingency buffer: `15%`

Formula:

- `llm_cost_per_query = (input_tokens/1,000,000 * input_rate) + (output_tokens/1,000,000 * output_rate)`
- `total_cost_per_query = llm_cost_per_query + non_llm_overhead`
- `monthly_queries = users * queries_per_day * 30`
- `monthly_cost = monthly_queries * total_cost_per_query * (1 + contingency)`

Worked baseline:

- `llm_cost_per_query = (1,800/1,000,000 * 3.00) + (700/1,000,000 * 12.00) = $0.0138`
- `total_cost_per_query = 0.0138 + 0.0015 = $0.0153`

---

## 10. Architectural Decisions, Trade-offs, and Implementation Plan

### 10.1 Architectural Decisions and Tools/Services

1. Use `LangGraph` orchestration on top of the existing `NestJS` service layer to avoid a parallel backend.
2. Keep a single-agent design in v1, with strict tool schemas and verification gates.
3. Use `OpenRouter` as the LLM gateway, with model routing based on query complexity.
4. Use `Redis` for short-lived conversation state and `Postgres` (`Prisma`) for durable traces/evals.
5. Use `LangSmith` plus structured application logs for traces, scoring, and incident analysis.
6. Deploy on `Railway` using app + Postgres + Redis services.
7. Start with five finance tools mapped to existing services: `portfolio_analysis`, `market_data`, `transaction_categorize`, `compliance_check`, `import_validation`.

### 10.2 Understanding of Trade-offs

1. `LangGraph` vs custom-only orchestration:
Pro: explicit stateful workflows and verification checkpoints.
Con: added framework integration overhead.
2. Single-agent vs multi-agent:
Pro: easier debugging and lower ops overhead.
Cons: less role specialization.
3. OpenRouter vs direct single-provider API:
Pro: model portability and fallback options.
Con: one additional dependency layer.
4. Strict verification before response:
Pro: lower unsupported-claim risk.
Con: additional latency and more low-confidence escalations.
5. Railway for hosting:
Pro: fast deployment and simple operations for a small team.
Con: less low-level infrastructure control than fully custom cloud setups.

### 10.3 General Implementation Plan

1. Implement the agent core module in NestJS: orchestrator, tool registry, verifier, and formatter.
2. Wire the initial five tools and enforce strict schema contracts for inputs/outputs.
3. Implement six verification checks: fact checking, hallucination detection, confidence scoring, domain constraints, output validation, and HITL escalation.
4. Add observability instrumentation for traces, latency, token/cost, and error taxonomy.
5. Build and run the required 50+ eval suite, then gate CI on target thresholds.
6. Optimize prompts/routing/timeouts to meet latency, accuracy, hallucination, and verification targets.
7. Roll out on Railway with alerts, feature flags, and a rollback playbook.
