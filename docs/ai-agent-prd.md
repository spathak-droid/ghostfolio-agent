# Product Requirements Document: Ghostfolio Finance AI Agent

**Version:** 0.1  
**Status:** Draft  
**Author:** Sandesh Pathak  
**Date:** February 23, 2026  
**Source:** [AI Agent Pre-Search Document](./ai-agent-presearch.md)

---

## 1. Product Overview

### 1.1 Vision

A finance-domain AI agent integrated into Ghostfolio that provides portfolio analysis, risk checks, market data interpretation, transaction categorization, and import validation. The agent is designed for **verification-first** behavior: traceability, source-backed claims, and production reliability are non-negotiable.

### 1.2 Problem Statement

Users need fast, trustworthy answers about their portfolios and market context. Generic chatbots lack domain grounding and can produce unsupported or harmful financial claims. Ghostfolio already has rich data and services; the agent must surface this through a single conversational interface while enforcing strict verification and permission boundaries.

### 1.3 Target Users (Initial)

- **Primary:** Ghostfolio users (initial scale: **100 users**)
- **Usage assumption:** 3–10 queries per user per day (300–1,000 daily queries)

### 1.4 Success Criteria (High Level)

- Answers are source-backed and traceable; unsupported claims are flagged or blocked.
- Latency and reliability meet defined SLOs; evals gate regressions.
- Cost and observability are predictable and within planned budgets.

---

## 2. Goals and Non-Goals

### 2.1 Goals

| Goal | Description |
|------|-------------|
| **Trust** | Every material claim has source metadata and timestamp; hallucination rate &lt;5%. |
| **Reliability** | Tool success rate &gt;95%; graceful degradation when providers fail. |
| **Performance** | Single-tool &lt;5s, multi-step (3+ tools) &lt;15s; concurrency 10–20 sessions. |
| **Observability** | Full request traces, token/cost tracking, and verification outcomes. |
| **Evals** | 50+ test cases, CI-gated; &gt;80% pass rate; regression detection. |

### 2.2 Non-Goals (Out of Scope for v1)

- Multi-agent or role-specialized agent architectures.
- Direct trading or order execution from the agent.
- Replacing existing Ghostfolio UI flows; agent is additive.
- Support for &gt;100 users in initial launch (scale-out is post-v1).

---

## 3. User Personas and Use Cases

### 3.1 Personas

- **Retail investor:** Wants portfolio summary, allocation explanation, and simple market context.
- **Power user:** Needs risk/exposure analysis, transaction categorization, and import validation.
- **Support/ops:** May use agent-assisted answers for debugging or user guidance (future).

### 3.2 Supported Use Cases (Phase 1)

1. **Portfolio analysis** — Summaries, allocations, performance explanation.
2. **Risk and exposure analysis** — Concentration, sector/asset exposure.
3. **Market data lookup with explanation** — Prices, returns, symbols; interpreted, not raw dump.
4. **Transaction categorization and pattern detection** — Categories, patterns, anomalies.
5. **Import/data validation** — Validate activity lists before import.

### 3.3 Out of Scope (Explicit)

- Trading recommendations that execute orders.
- Tax or legal advice.
- Real-time streaming quotes without staleness disclosure.
- Unauthenticated or cross-tenant data access.

---

## 4. Functional Requirements

### 4.1 Agent Core

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Single-agent design with tool-calling; orchestration via LangGraph on top of existing NestJS services. | P0 |
| FR-2 | Session state stored in Redis; persistent traces/evals/feedback in Postgres (Prisma). | P0 |
| FR-3 | LLM gateway: OpenRouter with support for model routing by query complexity. | P0 |
| FR-4 | Strict tool allowlist; no arbitrary code or untrusted tool execution. | P0 |

### 4.2 Tools (Minimum Viable Set)

| ID | Tool | Description | Priority |
|----|------|-------------|----------|
| FR-5 | `portfolio_analysis(userId, filters)` | Portfolio summary, allocations, performance. | P0 |
| FR-6 | `market_data(symbols, metrics, dateRange)` | Market data with explanation. | P0 |
| FR-7 | `transaction_categorize(userId, from, to)` | Categorization and pattern detection. | P0 |
| FR-8 | `compliance_check(userId, policySet)` | Policy/compliance checks. | P0 |
| FR-9 | `import_validation(activities[])` | Validate activities before import. | P0 |
| FR-10 | `risk_exposure(userId, filters)` | Risk and exposure analysis (extension). | P1 |

- All tools: input schema validation, timeout/retry, standardized typed errors; fallback provider where available.
- Data sources: internal Postgres/Prisma, Redis cache/snapshots, external providers (Yahoo, CoinGecko, configured adapters).

### 4.3 Verification (Implement 3+ at Launch; All 6 Planned)

| ID | Verification | Requirement | Priority |
|----|--------------|-------------|----------|
| FR-11 | Fact checking | Cross-reference claims to internal ledger + approved market providers; attach source metadata + timestamp. | P0 |
| FR-12 | Hallucination detection | Flag unsupported claims; require source attribution; block or downgrade if material claim lacks attribution. | P0 |
| FR-13 | Confidence scoring | Use source agreement, data freshness, completeness; surface low-confidence responses. Threshold: **0.8**. | P0 |
| FR-14 | Domain constraints | Enforce permission boundaries, stale quote thresholds, valid symbols/currencies, feature/subscription policy. | P0 |
| FR-15 | Output validation | Schema, format, and completeness validation before returning response. | P0 |
| FR-16 | Human-in-the-loop | Escalate when confidence &lt;0.8, conflicting sources, or high-risk recommendation with weak evidence. | P0 |

### 4.4 Observability and Audit

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-17 | LangSmith + custom structured logs for traces, latency, token/cost, verification outcomes. | P0 |
| FR-18 | Audit log per request: trace id, inputs, tool path, outputs summary, confidence, citations, timing, tokens, errors. | P0 |
| FR-19 | Metrics: E2E latency, LLM latency, tool latency, tool success/failure rate, verification failure rate, hallucination flag rate, token usage/cost, user feedback. | P0 |
| FR-20 | Cost tracking: per request, daily aggregate, feature-level breakdown. | P1 |

### 4.5 Evaluation and Quality

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-21 | Eval suite: minimum **50** test cases (20+ happy path, 10+ edge, 10+ adversarial, 10+ multi-step). | P0 |
| FR-22 | Each test: input query, expected tool calls, expected output, pass/fail criteria. | P0 |
| FR-23 | CI: PR smoke evals; full eval suite on merge/nightly; gate on **&gt;80%** pass rate. | P0 |
| FR-24 | Ground truth: internal deterministic portfolio calculations + frozen datasets. | P0 |

### 4.6 Security and Compliance

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-25 | Auth + authorization enforced per tool call; no cross-tenant data access. | P0 |
| FR-26 | Prompt injection mitigation: treat retrieved/tool text as untrusted; system policy overrides user/tool instructions. | P0 |
| FR-27 | Redact sensitive fields in responses and logs. | P0 |
| FR-28 | API keys via Railway env secrets; never expose provider keys to frontend. | P0 |

### 4.7 Deployment and Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-29 | Deploy on Railway (app + Postgres + Redis). | P0 |
| FR-30 | CI/CD: build, lint, test, eval-smoke on PR; health-gated deploy from main. | P0 |
| FR-31 | Alerts: latency SLO breaches, tool success-rate drops, verification/hallucination spikes, cost anomalies. | P0 |
| FR-32 | Rollback: previous Railway release + feature flags to disable risky agent capabilities. | P0 |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Target |
|--------|--------|
| Single-tool query latency | &lt;5 s |
| Multi-step (3+ tools) latency | &lt;15 s |
| Concurrency | 10–20 active sessions |
| Tool success rate | &gt;95% |

### 5.2 Reliability

- Retry transient tool failures once; use fallback provider where supported.
- Return partial answer with explicit warning if unresolved.
- Graceful degradation: last-known cached values with freshness warning; deterministic tool-only summary when LLM unavailable.
- Per-user and per-tool rate limits; queue non-urgent workloads; prefer cached snapshots under load.

### 5.3 Verification and Quality Targets

| Metric | Target |
|--------|--------|
| Eval pass rate | &gt;80% |
| Hallucination rate | &lt;5% unsupported claims |
| Verification accuracy | &gt;90% (correctly flagged + correctly passed) / total verified |

### 5.4 Cost (Planning Assumptions)

- Token budgets per request; model routing for cost control.
- Production projection (from presearch): ~$264/month at 100 users (5 queries/user/day, blended LLM + overhead + 15% contingency).
- Non-LLM overhead per query (tools, infra, verification): ~$0.0015.

---

## 6. Scope and Phasing

### 6.1 Phase 1 (MVP)

- Agent core (LangGraph + NestJS), OpenRouter, Redis session + Postgres traces.
- Five core tools: `portfolio_analysis`, `market_data`, `transaction_categorize`, `compliance_check`, `import_validation`.
- At least **3** verification systems live (fact checking, hallucination detection, confidence scoring + domain constraints + output validation + HITL as planned).
- Observability (LangSmith + structured logs), audit logging.
- Eval suite 50+ cases, CI-gated.
- Deploy on Railway with alerts and feature flags.

### 6.2 Phase 2 (Post-MVP)

- Sixth tool: `risk_exposure`.
- Full set of 6 verification systems if not all in Phase 1.
- User feedback (e.g. thumbs up/down, optional correction); eval-driven improvement cycle.
- Scale and cost optimization; monthly/quarterly review cadence.

### 6.3 Dependencies

- Existing Ghostfolio: NestJS, Prisma, Postgres, Redis, market data adapters (Yahoo, CoinGecko, etc.).
- OpenRouter API; LangGraph; LangSmith (or equivalent) for tracing.
- Railway for hosting.

---

## 7. Acceptance Criteria (Summary)

- [ ] User can ask portfolio/market/transaction/import questions and receive answers that cite sources and timestamps.
- [ ] No material claim is returned without attribution when verification is enabled.
- [ ] Confidence &lt;0.8 or conflicting evidence triggers HITL escalation (or safe fallback) as designed.
- [ ] All tool calls enforce auth and permission checks; no cross-tenant access.
- [ ] Latency and tool success rate meet NFR targets in staging/production.
- [ ] Eval suite runs in CI; regressions block merge when pass rate drops below threshold.
- [ ] Audit logs and traces are available for every request; cost is tracked per request and daily.

---

## 8. Open Source and Documentation

- Release: agent module scaffold, tool registry, verification layer, eval runner and dataset template.
- License: AGPL-3.0 compatible.
- Docs: setup/architecture, tool contracts, safety/verification policy, eval runbook.
- Community: labels for `agent`, `eval`, `safety`; contributor instructions for tools/evals.

---

## 9. References

- [AI Agent Pre-Search Document](./ai-agent-presearch.md) — assumptions, architecture, verification systems, cost model, implementation plan.
- Architectural decisions and trade-offs: see presearch §10.
- Cost formula and worked baseline: see presearch §9.3.

---

## 10. Appendix: Verification Accuracy Formula

`Verification accuracy = (correctly flagged + correctly passed) / total verified claims`  
Target: **&gt;90%**.
