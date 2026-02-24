# Agent Deploy Checklist

Keep this checklist as the minimum gate before shipping the standalone agent + widget integration.

1. **Tests & verification**
   - `npm run test:agent`
   - `npm run test -- --test-file=apps/api/src/app/agent` (or `npm run test:api -- --test-file=apps/api/src/app/agent`)
   - `npm run eval:agent` (smoke evals must still pass with the current model/tool combo)
   - `nx test client --test-file=apps/client/src/app/services/agent-widget.service.spec.ts`

2. **Configuration**
   - Set `AGENT_WIDGET_SCRIPT_URL` on every environment (`.env`, Railway env, etc.) to point at the built widget bundle (default dev value: `http://localhost:4444/widget/index.js`).
   - Ensure the agent service exposes the widget bundle via that URL before updating the UI; the UI mounts the script only when `/api/v1/info` exposes `agentWidgetScriptUrl`.

3. **Build & release**
   - `nx run agent:build` (if build target exists, otherwise compile via ts-node or deploy image as required).
   - `nx run api:build:production` + `nx run client:build:production` and ensure `replace-placeholders-in-build` picks up the final manifest.
   - Deploy the agent container/service (Railway service or other infrastructure). `AGENT_SERVICE_URL` must match the endpoint used by `/api/v1/agent/chat` and the widget URL.

4. **Post-deploy verification**
   - Visit `/api/v1/info` and confirm `agentWidgetScriptUrl` is populated as configured.
   - Open the Ghostfolio UI, confirm `AgentWidgetService` mounts the placeholder container, and the `<script src="...">` that bootstraps `agent/widget` is present in the DOM.
   - Smoke test the chat flow via `/api/v1/agent/chat` and surface any verification metadata (source citations, `verification.isValid`, etc.).

5. **Documentation**
   - Link to this checklist wherever release playbooks live (e.g., PR template, ops runbooks).
   - Note any environment overrides or backwards-incompatible changes so follow-on releases can reuse this checklist.
