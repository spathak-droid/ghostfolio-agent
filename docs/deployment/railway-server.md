# Deploy Ghostfolio API (server) to Railway

Manual deployment guide when you already have Redis and Postgres on Railway.

## What to include

- **Source**: Repository root (the same repo that contains the root `Dockerfile`).
- **Build**: Use the **existing root Dockerfile** — it builds the API and client and runs the API.
- **Database & cache**: Link your **existing Railway Postgres** and **Redis** to this service (no need to create new ones).

Railway will build the Docker image and run the container. The Dockerfile's entrypoint runs migrations, seeds the DB, then starts the server.

---

## Steps in Railway

1. **New service**
   - Create a new service in your project.
   - Connect the **GitHub repo** (or deploy from CLI with `railway up` from the repo root).

2. **Build**
   - **Deploy method**: Dockerfile.
   - **Dockerfile path**: `Dockerfile` (root).
   - Railway will run `docker build` from repo root; no extra build command needed.

3. **Link Postgres and Redis**
   - In the service → **Variables** (or **Connect**), add your existing **Postgres** and **Redis**.
   - Railway will inject:
     - `DATABASE_URL` (from Postgres)
     - `REDIS_URL` (from Redis)
   Use these; you don't need to set them by hand if you link the services.

4. **Required environment variables**

   Set these in the service's **Variables** (unless provided by linking):

   | Variable | Required | Notes |
   |----------|----------|--------|
   | `DATABASE_URL` | Yes | From linked Postgres (e.g. `postgresql://user:pass@host:5432/db?sslmode=require`) |
   | `REDIS_URL` | Yes | From linked Redis (e.g. `rediss://default:pass@host:6380`) |
   | `ACCESS_TOKEN_SALT` | Yes | Random string for token hashing (e.g. `openssl rand -hex 32`) |
   | `JWT_SECRET_KEY` | Yes | Random string for JWT (e.g. `openssl rand -hex 32`) |
   | `ROOT_URL` | Yes | Public URL of this app (e.g. `https://your-app.railway.app`) |
   | `PORT` | No | Railway sets this; app listens on it (default 3333). |

5. **Optional (recommended for production)**

   | Variable | Notes |
   |----------|--------|
   | `NODE_ENV` | Set to `production` (Dockerfile already sets it). |
   | `AGENT_SERVICE_URL` | If you deploy the agent later, set to agent URL (e.g. `https://your-agent.railway.app`). |
   | `AGENT_WIDGET_SCRIPT_URL` | Same base as agent, e.g. `https://your-agent.railway.app/widget/index.js`. |

6. **Optional (features / APIs)**

   All have defaults; set only if you use the feature:

   - Google OAuth: `ENABLE_FEATURE_AUTH_GOOGLE=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET`
   - OIDC: `ENABLE_FEATURE_AUTH_OIDC=true` and the `OIDC_*` vars from `.env.example`
   - Subscription (Stripe): `ENABLE_FEATURE_SUBSCRIPTION=true`, `STRIPE_SECRET_KEY`
   - Data provider API keys: `API_KEY_ALPHA_VANTAGE`, `API_KEY_EOD_HISTORICAL_DATA`, etc.

   See [.env.example](../../.env.example) and [configuration.service.ts](../../apps/api/src/services/configuration/configuration.service.ts) for the full list.

7. **Start**
   - No custom start command needed. The image **CMD** runs `entrypoint.sh`, which:
     1. Runs `npx prisma migrate deploy`
     2. Runs `npx prisma db seed`
     3. Runs `node main` (from `WORKDIR /ghostfolio/apps/api`)

8. **Health**
   - Railway expects the app to listen on `PORT`. The API uses `PORT` from env (or 3333).
   - After deploy, open `https://your-app.railway.app` — you should get the Ghostfolio client (served by the API).

---

## Summary checklist

- [ ] New service from repo; build from root **Dockerfile**
- [ ] Link **Postgres** → `DATABASE_URL` set automatically
- [ ] Link **Redis** → `REDIS_URL` set automatically
- [ ] Set **ACCESS_TOKEN_SALT**, **JWT_SECRET_KEY**, **ROOT_URL**
- [ ] Set **ROOT_URL** to your Railway app URL (e.g. `https://ghostfolio-api.railway.app`)
- [ ] (Later) Set **AGENT_SERVICE_URL** and **AGENT_WIDGET_SCRIPT_URL** when the agent is deployed

---

## Notes

- **Seed on every deploy**: The entrypoint runs `prisma db seed` on every container start. If your seed is not idempotent and you want to run it only once, you can add a custom start command in Railway that skips seed (e.g. run only `node main` after the first successful deploy).
- **Agent**: Deploy the agent as a separate Railway service; see [railway-agent.md](railway-agent.md). Then set `AGENT_SERVICE_URL` and `AGENT_WIDGET_SCRIPT_URL` on this API service and redeploy.
