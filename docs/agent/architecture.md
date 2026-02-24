# Agent Architecture

This project introduces a standalone `apps/agent` layer:

- `server/`: orchestrator, tool calls, verification, and HTTP entrypoint.
- `widget/`: embeddable browser widget entry.
- `test/`: unit tests, fixtures, and eval datasets.

The agent talks to Ghostfolio APIs via JWT forwarding.
