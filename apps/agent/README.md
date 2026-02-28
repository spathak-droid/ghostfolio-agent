# @ghostfolio/agent

AI-powered portfolio assistant agent for Ghostfolio. Provides natural language portfolio analysis, market data lookups, and financial Q&A with LLM-backed reasoning.

## Installation

```bash
# Install globally
npm install -g @ghostfolio/agent

# Or use npx without installing
npx @ghostfolio/agent
```

## Configuration

The agent requires a Ghostfolio API backend and an LLM provider. Set these environment variables:

### Required
- **`GHOSTFOLIO_BASE_URL`** - Ghostfolio API endpoint (default: `http://localhost:3333`)
- **`OPENAI_API_KEY`** - OpenAI API key for LLM reasoning, OR
- **`OPENROUTER_API_KEY`** - OpenRouter API key (alternative to OpenAI)

### Optional
- **`AGENT_PORT`** - Server port (default: `4444`)
- **`AGENT_HOST`** - Server host (default: `localhost`)
- **`AGENT_LOG_LEVEL`** - Logging verbosity: `silent`, `info`, or `debug` (default: `info` in dev, `silent` in production)
- **`AGENT_REDIS_URL`** - Redis connection string for response caching (optional)
- **`DATABASE_URL`** - PostgreSQL connection string for feedback/regulation persistence (optional)
- **`AGENT_WIDGET_DIST_PATH`** - Path to widget distribution files (optional)
- **`AGENT_WIDGET_CORS_ORIGIN`** - CORS origin for widget embedding (optional)
- **`NODE_ENV`** - `production` or `development`

## Usage

### Start the Agent Server

```bash
ghostfolio-agent
# or
npx @ghostfolio/agent
```

The server will start on `http://localhost:4444` and log:
```
[agent] listening { host: 'localhost', port: 4444, logLevel: 'info' }
[agent] ready { message: 'Keep this terminal open. Test: curl http://localhost:4444/health' }
```

### Test the Health Endpoint

```bash
curl http://localhost:4444/health
# Expected response: {"status":"ok"}
```

### Send a Chat Message

```bash
curl -X POST http://localhost:4444/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are my top 5 holdings?"}'
```

## API Endpoints

- **`GET /health`** - Health check
- **`POST /chat`** - Send message and get response (supports streaming)
- **`POST /acknowledge`** - Acknowledge pending clarifications
- **`POST /feedback`** - Submit feedback on agent responses
- **`POST /clear`** - Clear conversation history
- **`GET /history`** - Get conversation history
- **`POST /history/list`** - List all conversations

## Architecture

The agent is structured in layers:

- **LLM Router** - Determines which tools to call based on user intent
- **Tools** - Specialized modules for market data, portfolio analysis, tax calculations, compliance checks, etc.
- **Verification** - Validates outputs for safety, correctness, and compliance
- **Storage** - Persists conversation history and feedback (optional Postgres backend)
- **HTTP Server** - Express-based REST API with streaming support

## Requirements

- **Node.js** >= 22.18.0
- **Ghostfolio API** running (locally or remote)
- **LLM API Key** (OpenAI or OpenRouter)

## Troubleshooting

### Agent won't start
- Check `GHOSTFOLIO_BASE_URL` is reachable: `curl $GHOSTFOLIO_BASE_URL/api/v1/health`
- Verify `.env` file has required vars: `OPENAI_API_KEY`, `GHOSTFOLIO_BASE_URL`

### "No LLM API key found"
- Set `OPENAI_API_KEY` (OpenAI) or `OPENROUTER_API_KEY` (OpenRouter)

### Port already in use
- Change `AGENT_PORT`: `AGENT_PORT=5555 ghostfolio-agent`

## License

AGPL-3.0

## Links

- **Main Repository:** https://github.com/ghostfolio/ghostfolio
- **Documentation:** https://ghostfolio.io/docs
- **Support:** https://github.com/ghostfolio/ghostfolio/issues
