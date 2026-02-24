# Development Log 1

## Scope
This log captures all completed work for the Ghostfolio AgentForge implementation up to this point.

## Decisions Made
- Chose a standalone agent layer inside the same forked repo (`apps/agent`) instead of keeping all logic inside `apps/api`.
- Kept in-repo integration by proxying Ghostfolio API route `/api/v1/agent/chat` to the standalone agent service.
- Followed TDD-first workflow throughout.

## What Was Built

### 1. Initial API agent slice (completed first)
- Added API `agent` module/controller/service.
- Added endpoint `POST /api/v1/agent/chat`.
- Added structured response contract (`answer`, `toolCalls`, `verification`, `errors`, `conversation`).
- Added DTO validation for request payload (`conversationId`, `message`).

### 2. Standalone agent app (`apps/agent`)
Created a separate agent app structure with:
- `server/`
  - orchestrator (`agent.ts`)
  - HTTP entrypoint (`index.ts`)
  - Ghostfolio API client (`ghostfolio-client.ts`)
  - tools:
    - `portfolio-analysis.ts`
    - `market-data-lookup.ts`
    - `transaction-categorize.ts`
  - verification:
    - `domain-constraints.ts`
    - `confidence-scorer.ts`
    - `output-validator.ts`
  - eval runner (`server/eval/eval-runner.ts`)
- `widget/`
  - placeholder widget mount and dev html
- `test/`
  - unit tests
  - eval dataset + runner
  - fixtures

### 3. API -> standalone integration
- Reworked `apps/api` agent service into a proxy client to standalone service.
- `/api/v1/agent/chat` now forwards:
  - request body
  - Authorization header (JWT) to standalone agent.
- Added graceful fallback when standalone agent or downstream tool call fails.

### 4. Verification behavior
- Added finance-domain constraint flagging for deterministic advice language.
- Updated logic to consider both generated answer and user input for flagging.

### 5. Eval framework (MVP level)
- Added eval dataset with 6 cases (`apps/agent/test/eval/cases.json`).
- Added runner (`npm run eval:agent`).
- Cases cover:
  - portfolio tool routing
  - market data tool routing
  - transaction categorization
  - adversarial deterministic-advice flag
  - expected answer fragments

## Environment Setup Added
Added to local `.env`:
- `AGENT_PORT=4444`
- `AGENT_SERVICE_URL=http://localhost:4444`
- `GHOSTFOLIO_BASE_URL=http://localhost:3333` (or 3335 when testing alternate server port)

## Commands Verified
- `npx nx test api --test-file=apps/api/src/app/agent`
- `npx nx test agent`
- `npm run eval:agent`
- `npx tsc -p apps/api/tsconfig.app.json --noEmit`
- `npx tsc -p apps/agent/tsconfig.json --noEmit`

## Live Smoke Test Status
Verified end-to-end with both services running:
- Standalone agent: `npm run start:agent`
- API proxy: `npm run start:server` (with `AGENT_SERVICE_URL`)
- Successful response path verified (`transaction_categorize`).
- JWT-forwarded portfolio path verified; with invalid JWT it fails gracefully as expected.
- With valid JWT, portfolio analysis returns structured successful response.

## Current State
- Standalone architecture is active and integrated.
- API hard-gate behavior is present for core path.
- 3 core tool paths exist.
- Verification and eval baseline are in place.

## Remaining Work (next)
- Add minimal widget/UI mount into Ghostfolio client flow.
- Expand eval breadth toward full submission target.
- Add deployment docs/checklist and finalize public deployment.
