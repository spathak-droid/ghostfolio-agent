import {
  AUTH_ANONYMOUS_PATH,
  CHAT_API_PATH,
  FEEDBACK_API_PATH,
  GHOST_ICON_PATH
} from './constants';

export function resolveChatApiUrl(): string {
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-agent-widget-script]'
  );
  const base = script?.getAttribute('data-api-base');
  if (base) {
    return base.replace(/\/$/, '') + CHAT_API_PATH;
  }
  return CHAT_API_PATH;
}

export function resolveAuthApiUrl(): string {
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-agent-widget-script]'
  );
  const base = script?.getAttribute('data-api-base');
  if (base) {
    return base.replace(/\/$/, '') + AUTH_ANONYMOUS_PATH;
  }
  return AUTH_ANONYMOUS_PATH;
}

export function resolveFeedbackApiUrl(chatApiUrl: string): string {
  if (chatApiUrl.endsWith(CHAT_API_PATH)) {
    return chatApiUrl.slice(0, -CHAT_API_PATH.length) + '/api/v1/agent/feedback';
  }
  if (chatApiUrl.endsWith('/chat')) {
    return chatApiUrl.slice(0, -'/chat'.length) + '/feedback';
  }
  return FEEDBACK_API_PATH;
}

export function resolveClearConversationApiUrl(chatApiUrl: string): string {
  if (chatApiUrl.endsWith(CHAT_API_PATH)) {
    return chatApiUrl.slice(0, -CHAT_API_PATH.length) + CHAT_API_PATH + '/clear';
  }
  if (chatApiUrl.endsWith('/chat')) {
    return chatApiUrl + '/clear';
  }
  return CHAT_API_PATH + '/clear';
}

export function generateConversationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
}

export function resolveGhostIconPath(): string {
  const widgetScript = document.querySelector<HTMLScriptElement>(
    'script[data-agent-widget-script]'
  );

  if (widgetScript?.src) {
    try {
      return new URL('./asset/ghost.svg', widgetScript.src).toString();
    } catch {
      // fall through to default
    }
  }

  return GHOST_ICON_PATH;
}
