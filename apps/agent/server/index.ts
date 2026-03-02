#!/usr/bin/env node
import 'dotenv/config';

import { logger } from './utils';
import { installCrashHandlers } from './crash-handlers';
import { buildServerConfig } from './server-config';
import { createAgentWithClient } from './agent-factory';
import { createAgentApp, resolveWidgetRuntimeConfig } from './http/app-factory';
import { createAcknowledgeHandler } from './http/acknowledge-handler';
import { createChatHandler } from './http/chat-handler';
import { createClearHandler } from './http/clear-handler';
import { createFeedbackHandler } from './http/feedback-handler';
import { createHistoryGetHandler } from './http/history-get-handler';
import { createHistoryListHandler } from './http/history-list-handler';
import { createRateLimitMiddleware } from './http/rate-limit';

// Process-level crash handlers (installed before async code runs)
installCrashHandlers();

// Keep event loop active from the start (avoids exit under nodemon before server is fully bound)
// eslint-disable-next-line @typescript-eslint/no-empty-function
const earlyKeepAlive = setInterval(() => {}, 1000);

try {
  // Build server configuration from environment
  const config = buildServerConfig();

  const { widgetCorsOrigin, widgetDistPath } = resolveWidgetRuntimeConfig(
    process.cwd(),
    process.env.AGENT_WIDGET_DIST_PATH,
    process.env.AGENT_WIDGET_CORS_ORIGIN
  );

  // Create the Express app with all handlers
  const app = createAgentApp({
    acknowledgeHandler: createAcknowledgeHandler({
      allowBodyAccessToken: config.allowBodyAccessToken,
      allowInsecureGhostfolioHttp: config.allowInsecureGhostfolioHttp,
      conversationHistoryStore: config.conversationHistoryStore,
      ghostfolioAllowedHosts: config.ghostfolioAllowedHosts,
      ghostfolioBaseUrl: config.ghostfolioBaseUrl
    }),
    acknowledgeRateLimiter: createRateLimitMiddleware({
      maxRequests: 120,
      windowMs: 60_000
    }),
    chatHandler: createChatHandler({
      allowBodyAccessToken: config.allowBodyAccessToken,
      allowInsecureGhostfolioHttp: config.allowInsecureGhostfolioHttp,
      conversationHistoryStore: config.conversationHistoryStore,
      createAgentWithClient: (ghostfolioClient, storeScopeId) =>
        createAgentWithClient(config, ghostfolioClient, storeScopeId),
      ghostfolioAllowedHosts: config.ghostfolioAllowedHosts,
      ghostfolioBaseUrl: config.ghostfolioBaseUrl
    }),
    chatRateLimiter: createRateLimitMiddleware({
      maxRequests: config.chatRateLimitMax,
      windowMs: config.chatRateLimitWindowMs
    }),
    clearHandler: createClearHandler({
      allowBodyAccessToken: config.allowBodyAccessToken,
      conversationStore: config.conversationStore,
      conversationHistoryStore: config.conversationHistoryStore,
      ghostfolioBaseUrl: config.ghostfolioBaseUrl,
      allowInsecureGhostfolioHttp: config.allowInsecureGhostfolioHttp,
      ghostfolioAllowedHosts: config.ghostfolioAllowedHosts
    }),
    clearRateLimiter: createRateLimitMiddleware({
      maxRequests: config.clearRateLimitMax,
      windowMs: config.clearRateLimitWindowMs
    }),
    feedbackHandler: createFeedbackHandler({
      allowBodyAccessToken: config.allowBodyAccessToken,
      allowInsecureGhostfolioHttp: config.allowInsecureGhostfolioHttp,
      feedbackStore: config.feedbackStore,
      ghostfolioAllowedHosts: config.ghostfolioAllowedHosts,
      ghostfolioBaseUrl: config.ghostfolioBaseUrl
    }),
    feedbackRateLimiter: createRateLimitMiddleware({
      maxRequests: config.feedbackRateLimitMax,
      windowMs: config.feedbackRateLimitWindowMs
    }),
    historyGetHandler: createHistoryGetHandler({
      allowBodyAccessToken: config.allowBodyAccessToken,
      allowInsecureGhostfolioHttp: config.allowInsecureGhostfolioHttp,
      conversationHistoryStore: config.conversationHistoryStore,
      ghostfolioAllowedHosts: config.ghostfolioAllowedHosts,
      ghostfolioBaseUrl: config.ghostfolioBaseUrl
    }),
    historyListHandler: createHistoryListHandler({
      allowBodyAccessToken: config.allowBodyAccessToken,
      allowInsecureGhostfolioHttp: config.allowInsecureGhostfolioHttp,
      conversationHistoryStore: config.conversationHistoryStore,
      ghostfolioAllowedHosts: config.ghostfolioAllowedHosts,
      ghostfolioBaseUrl: config.ghostfolioBaseUrl
    }),
    historyRateLimiter: createRateLimitMiddleware({
      maxRequests: config.historyRateLimitMax,
      windowMs: config.historyRateLimitWindowMs
    }),
    widgetCorsOrigin,
    widgetDistPath
  });

  // Start listening
  const effectiveLogLevel = (
    process.env.AGENT_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'silent' : 'info')
  )
    .toLowerCase()
    .trim();

  const server = app.listen(config.port, config.host, () => {
    logger.info('[agent] listening', {
      host: config.host,
      port: config.port,
      logLevel: effectiveLogLevel || '(default)'
    });
    logger.info('[agent] ready', {
      message: 'Keep this terminal open. Test: curl http://localhost:4444/health'
    });
  });

  // Keep process alive under nodemon/shell (refs + tight interval so event loop never drains)
  const keepAlive = setInterval(() => {
    if (!server.listening) clearInterval(keepAlive);
  }, 30000);
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const tick = setInterval(() => {}, 1000);

  server.on('close', () => {
    clearInterval(earlyKeepAlive);
    clearInterval(keepAlive);
    clearInterval(tick);
  });

  const g = globalThis as unknown as {
    __agentServer?: unknown;
    __agentKeepAlive?: NodeJS.Timeout;
    __agentTick?: NodeJS.Timeout;
  };
  g.__agentServer = server;
  g.__agentKeepAlive = keepAlive;
  g.__agentTick = tick;

  if (process.stdin.isTTY === false && typeof process.stdin.resume === 'function') {
    process.stdin.resume();
  }
} catch (startupError) {
  const message =
    startupError instanceof Error ? startupError.message : String(startupError);
  const stack = startupError instanceof Error ? startupError.stack : undefined;
  // eslint-disable-next-line no-console
  console.error('[agent] STARTUP_FAILED', message, stack ?? '');
  logger.error('[agent] STARTUP_FAILED', message, stack ?? '');
  process.exitCode = 1;
  process.exit(1);
}
