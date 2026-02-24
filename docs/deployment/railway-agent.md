# Deploy Ghostfolio Agent to Railway

Deploy the agent as a **separate Railway service** so the API can proxy chat and the browser can load the widget. The API (server) must already be deployed and reachable.

## What gets deployed

- **Agent server**: Express app that serves `/chat` (POST) and `/widget` (static widget bundle).
- **Widget**: Built at image build time; served at `/widget/index.js` and `/widget/asset/...`.

## Prerequisites

- Ghostfolio **API (server)** already deployed and public (e.g. `https://your-api.railway.app`).
- You will set `AGENT_SERVICE_URL` and `AGENT_WIDGET_SCRIPT_URL` on the **API** service to point at this agent’s public URL after deploy.

---

## Steps in Railway

### 1. New service from repo

- In the same project (or the one that has your API), create a **New** → **GitHub Repo** service.
- Select the **same Ghostfolio repo** you use for the API.

### 2. Use the agent Dockerfile

- Open the new service → **Settings**.
- **Build**:
  - **Builder**: Dockerfile.
  - **Dockerfile path**: `apps/agent/Dockerfile`
  - **Root directory**: leave **empty** (build context must be repo root so the Dockerfile can see `package.json` and `apps/agent`).

Railway will run the equivalent of `docker build -f apps/agent/Dockerfile .` from the repo root.

### 3. Required environment variables

In the agent service **Variables**, set:

| Variable | Required | Notes |
|----------|----------|--------|
| `GHOSTFOLIO_BASE_URL` | Yes | Public URL of your Ghostfolio API (e.g. `https://your-api.railway.app`). No trailing slash. |
| `OPENAI_API_KEY` | Yes | OpenAI API key (or OpenRouter key if you switch the agent to OpenRouter). |
| `PORT` | No | Railway sets this automatically. The agent listens on it. |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini`. Set to another model if needed. |

### 4. Optional variables

| Variable | Notes |
|----------|--------|
| `AGENT_WIDGET_DIST_PATH` | Override widget path (default `dist/apps/agent/widget`). |
| `AGENT_WIDGET_CORS_ORIGIN` | Restrict widget CORS (default `*`). Set to your client origin, e.g. `https://your-api.railway.app`. |

### 5. Public URL and networking

- In the agent service → **Settings** → **Networking**, ensure **Public networking** is on.
- **Generate domain** if none exists. Note the URL (e.g. `https://ghostfolio-agent-xxxx.up.railway.app`). This is your **agent base URL**.

### 6. Point the API at the agent

On your **Ghostfolio API** service (the one that runs the main app):

- Add or set **Variables**:
  - `AGENT_SERVICE_URL` = agent base URL (e.g. `https://ghostfolio-agent-xxxx.up.railway.app`)
  - `AGENT_WIDGET_SCRIPT_URL` = agent base URL + `/widget/index.js` (e.g. `https://ghostfolio-agent-xxxx.up.railway.app/widget/index.js`)
- Redeploy the API (or let it pick up the new env on next deploy).

The API uses `AGENT_SERVICE_URL` to proxy `/api/v1/agent/chat` to the agent, and the client loads the widget from `AGENT_WIDGET_SCRIPT_URL` (exposed via `/api/v1/info`).

---

## Summary checklist

- [ ] New Railway service from same repo; Dockerfile path **`apps/agent/Dockerfile`**, root directory **empty**
- [ ] Set **`GHOSTFOLIO_BASE_URL`** (your API URL) and **`OPENAI_API_KEY`**
- [ ] Generate a **public domain** for the agent and note the URL
- [ ] On the **API** service, set **`AGENT_SERVICE_URL`** and **`AGENT_WIDGET_SCRIPT_URL`**, then redeploy API
- [ ] Open Ghostfolio in the browser and confirm the chat widget appears and chat works

---

## Verification

- **Agent health**: `https://<agent-domain>/health` → `{"status":"ok"}`
- **Widget**: `https://<agent-domain>/widget/index.js` → JavaScript
- **API info**: `https://<api-domain>/api/v1/info` → `agentWidgetScriptUrl` should be `https://<agent-domain>/widget/index.js`
- In the Ghostfolio UI, open the agent panel and send a message; it should go through the API to the agent and return a response.
