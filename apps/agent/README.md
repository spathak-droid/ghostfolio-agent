# ghostfolio-agent

AI-powered portfolio assistant agent for Ghostfolio. Provides natural language portfolio analysis, market data lookups, and financial Q&A with LLM-backed reasoning.

## Installation

```bash
# Install globally
npm install -g ghostfolio-agent

# Or use npx without installing
npx ghostfolio-agent
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

### Create .env File

Create a `.env` file with your configuration:

```bash
cat > .env <<'EOF'
GHOSTFOLIO_BASE_URL=https://your-ghostfolio-instance.com
OPENAI_API_KEY=sk-proj-your-api-key-here
AGENT_PORT=4444
EOF
```

### Start the Agent Server

```bash
ghostfolio-agent
# or
npx ghostfolio-agent
```

The server will start on `http://localhost:4444` and log:
```
[agent] GHOSTFOLIO_BASE_URL= https://your-ghostfolio-instance.com
[agent] listening { host: '0.0.0.0', port: 4444, logLevel: 'info' }
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
  -H "Authorization: Bearer YOUR_GHOSTFOLIO_TOKEN" \
  -d '{
    "message": "What are my top 5 holdings?",
    "conversationId": "user-123"
  }'
```

**Note:**
- `conversationId` is required (any unique string to track the conversation)
- `Authorization` header should contain your Ghostfolio bearer token
- Response includes agent answer and tool execution details

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
- Verify `.env` file exists with required vars: `OPENAI_API_KEY`, `GHOSTFOLIO_BASE_URL`
- Check logs: `AGENT_LOG_LEVEL=debug ghostfolio-agent`

### "GHOSTFOLIO_BASE_URL not set"
- Create `.env` file with `GHOSTFOLIO_BASE_URL=https://your-instance.com`
- Or set via environment: `GHOSTFOLIO_BASE_URL=https://... npx ghostfolio-agent`

### "No LLM configured"
- Set `OPENAI_API_KEY` (OpenAI) or `OPENROUTER_API_KEY` (OpenRouter) in `.env`

### Port already in use
- Change `AGENT_PORT` in `.env`: `AGENT_PORT=5555`
- Or run: `AGENT_PORT=5555 npx ghostfolio-agent`

### Chat endpoint returns validation error
- Ensure request includes `conversationId` in the JSON body
- Ensure `Authorization: Bearer TOKEN` header with valid Ghostfolio token

## License

AGPL-3.0

## Links

- **Main Repository:** https://github.com/ghostfolio/ghostfolio
- **Documentation:** https://ghostfolio.io/docs
- **Support:** https://github.com/ghostfolio/ghostfolio/issues
