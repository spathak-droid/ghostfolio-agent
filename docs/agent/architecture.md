# Agent Architecture

The agent is built from six components. Implementation lives under `apps/agent/server/`.

## Component Requirements

| Component | Requirement | Implementation |
|-----------|-------------|-----------------|
| **Reasoning Engine** | LLM with structured output, chain-of-thought capability | `openai-client.ts`: `reasonAboutQuery`, `selectTool`, `answerFinanceQuestion`; JSON responses for routing and tool selection. |
| **Tool Registry** | Defined tools with schemas, descriptions, and execution logic | `tools/tool-registry.ts`: `TOOL_DEFINITIONS` (name, description, input_schema, output_schema, error_model, idempotent). Execution wired in `index.ts` via existing tool modules. |
| **Memory System** | Conversation history, context management, state persistence | `agent.ts`: in-memory `Map<conversationId, messages>`; last 6 messages passed to LLM; conversation appended each turn. |
| **Orchestrator** | Decides when to use tools, handles multi-step reasoning | `agent.ts`: `decideRoute`, `selectTools`, `executeTool`, transaction-dependent flow (get_transactions → categorize/timeline). |
| **Verification Layer** | Domain-specific checks before returning responses | `verification/`: `domain-constraints.ts`, `output-validator.ts`, `confidence-scorer.ts`; flags (e.g. missing_provenance, tool_failure); `isValid` and confidence score. |
| **Output Formatter** | Structured responses with citations and confidence | `AgentChatResponse`: answer, conversation, errors, toolCalls, verification (confidence, flags, isValid). `synthesis/tool-result-synthesizer.ts` builds natural-language from tool results. |

## Layout

- `server/`: orchestrator, tool calls, verification, HTTP entrypoint.
- `server/tools/`: tool implementations and **tool registry** (schemas, descriptions).
- `server/verification/`: domain constraints, output validation, confidence.
- `server/synthesis/`: tool result → natural language.
- `widget/`: embeddable browser widget.
- `test/`: unit tests and eval.

The agent talks to Ghostfolio APIs via token forwarding.
