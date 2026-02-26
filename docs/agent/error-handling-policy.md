# Agent Error Handling Policy

## Scope

This policy applies to the standalone agent service in `apps/agent`.

## Response Contract

### Expected failures

Expected runtime failures must return HTTP `200` with structured failure metadata in the response body:

- `errors[]`: agent-level orchestration failures.
- `toolCalls[]`: per-tool execution outcomes (`success: true|false`).

Expected failures include:

- Tool execution failures/timeouts
- LLM execution failures/timeouts
- Tool-reported failures (`{ success: false, error: ... }`)

### Unexpected failures

Unhandled exceptions at the `/chat` boundary return HTTP `500` with:

- `error: "AGENT_CHAT_FAILED"`
- Generic user-safe `answer`

No internal stack traces or raw error payloads are returned in the 500 body.

## Two Error Channels

Both channels are intentionally used and serve different consumers:

1. `errors[]` (agent-level)
- Canonical orchestration status for clients.
- Codes: `TOOL_EXECUTION_*`, `LLM_EXECUTION_*`.
- Includes `recoverable` for retry guidance.

2. `toolCalls[].result.error` (tool-level)
- Tool-specific diagnostics and domain detail.
- Shape: `{ error_code, message, retryable }`.
- Used for debugging and synthesis detail.

Client guidance:

- Use `errors[]` as the primary failure signal.
- Use `toolCalls` for per-tool diagnostics and attribution.

## Recoverability Rules

- Tool-reported failures: `errors[].recoverable` mirrors tool `error.retryable`.
- Thrown tool errors: if error object provides `retryable`, use it; otherwise default to `true`.
- Timeouts are treated as recoverable (`true`).

