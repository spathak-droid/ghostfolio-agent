# Build and run the Ghostfolio agent (chat + widget).
# Build context must be the repository root (e.g. docker build -f apps/agent/Dockerfile .)

FROM node:22-slim

WORKDIR /app

# Install deps (include devDependencies for ts-node and esbuild).
# Use npm install so build succeeds when package-lock.json is out of sync with package.json.
COPY package.json package-lock.json ./
RUN npm install

# Agent source and widget build
COPY apps/agent apps/agent
RUN npm run build:agent-widget

# Railway sets PORT; agent uses PORT or AGENT_PORT (see index.ts)
EXPOSE 4444
ENV NODE_ENV=production

CMD ["npx", "ts-node", "apps/agent/server/index.ts"]
