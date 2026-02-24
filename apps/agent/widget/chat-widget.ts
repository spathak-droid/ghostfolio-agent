const AGENT_WIDGET_MOUNTED_ATTR = 'data-ghostfolio-agent-mounted';
const CHATBOX_OPEN_CLASS = 'agent-widget--open';
const GHOST_ICON_PATH = '/widget/asset/ghost.svg';
const STYLE_ELEMENT_ID = 'ghostfolio-agent-widget-style';
const CHAT_API_PATH = '/api/v1/agent/chat';
/** Same key as Ghostfolio client TokenStorageService (auth-token) for same-origin auth. */
const AUTH_TOKEN_STORAGE_KEY = 'auth-token';
const IMPERSONATION_STORAGE_KEY = 'impersonationId';
const IMPERSONATION_HEADER = 'Impersonation-Id';

function getAuthToken(): string | null {
  try {
    return (
      window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ||
      window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

function getImpersonationId(): string | null {
  try {
    return window.localStorage.getItem(IMPERSONATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface AgentChatResponse {
  answer: string;
  errors?: { code: string; message: string; recoverable: boolean }[];
}

function resolveChatApiUrl(): string {
  const script = document.querySelector<HTMLScriptElement>(
    'script[data-agent-widget-script]'
  );
  const base = script?.getAttribute('data-api-base');
  if (base) {
    return base.replace(/\/$/, '') + CHAT_API_PATH;
  }
  return CHAT_API_PATH;
}

function generateConversationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
}

function formatMessageTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function mountChatWidget(container: HTMLElement) {
  if (!container || container.hasAttribute(AGENT_WIDGET_MOUNTED_ATTR)) {
    return;
  }

  injectWidgetStyles();
  container.setAttribute(AGENT_WIDGET_MOUNTED_ATTR, 'true');

  const conversationId = generateConversationId();
  const chatApiUrl = resolveChatApiUrl();

  const widget = document.createElement('div');
  widget.className = 'agent-widget';

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'agent-widget__launcher';
  launcher.setAttribute('aria-label', 'Open agent chat');

  const launcherIcon = document.createElement('img');
  launcherIcon.className = 'agent-widget__launcher-icon';
  launcherIcon.src = resolveGhostIconPath();
  launcherIcon.alt = 'Ghostfolio agent';
  launcher.appendChild(launcherIcon);

  const panel = document.createElement('section');
  panel.className = 'agent-widget__panel';

  const header = document.createElement('header');
  header.className = 'agent-widget__header';

  const headerIcon = document.createElement('img');
  headerIcon.className = 'agent-widget__header-icon';
  headerIcon.src = resolveGhostIconPath();
  headerIcon.alt = '';
  headerIcon.setAttribute('aria-hidden', 'true');

  const headerContent = document.createElement('div');
  headerContent.className = 'agent-widget__header-content';

  const title = document.createElement('h2');
  title.className = 'agent-widget__title';
  title.textContent = 'Ghostfolio Agent';

  const subtitle = document.createElement('p');
  subtitle.className = 'agent-widget__subtitle';
  subtitle.textContent = 'Ask about your portfolio or market context';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'agent-widget__close';
  closeButton.setAttribute('aria-label', 'Minimize chat');
  closeButton.textContent = '×';

  headerContent.appendChild(title);
  headerContent.appendChild(subtitle);
  header.appendChild(headerIcon);
  header.appendChild(headerContent);
  header.appendChild(closeButton);

  const messages = document.createElement('ul');
  messages.className = 'agent-widget__messages';
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-label', 'Chat messages');

  const suggestions = [
    'Analyze my portfolio',
    'Show market data for a symbol',
    'Help categorize my transactions',
    'Summarize my portfolio allocation'
  ] as const;

  function createWelcomeMessage(): HTMLElement {
    const li = document.createElement('li');
    li.className = 'agent-widget__message agent-widget__message--assistant agent-widget__message--welcome';

    const timeEl = document.createElement('span');
    timeEl.className = 'agent-widget__message-time';
    timeEl.textContent = formatMessageTime(new Date());
    li.appendChild(timeEl);

    const body = document.createElement('div');
    body.className = 'agent-widget__message-body';

    const intro = document.createElement('p');
    intro.className = 'agent-widget__welcome-intro';
    intro.textContent =
      "Hi, I'm your Ghostfolio agent. I can help you analyze your portfolio, look up market data, and categorize transactions. Try one of the suggestions below or ask anything.";
    body.appendChild(intro);

    const list = document.createElement('ul');
    list.className = 'agent-widget__suggestions';
    list.setAttribute('aria-label', 'Suggested questions');
    for (const label of suggestions) {
      const item = document.createElement('li');
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'agent-widget__suggestion-chip';
      chip.textContent = label;
      chip.addEventListener('click', () => {
        input.value = label;
        input.focus();
      });
      item.appendChild(chip);
      list.appendChild(item);
    }
    body.appendChild(list);
    li.appendChild(body);
    return li;
  }

  messages.appendChild(createWelcomeMessage());

  const form = document.createElement('form');
  form.className = 'agent-widget__form';
  form.setAttribute('aria-label', 'Chat with the finance agent');

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Tell me something about your portfolio';
  input.autocomplete = 'off';
  input.className = 'agent-widget__input';

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'agent-widget__send';
  button.setAttribute('aria-label', 'Send');
  button.innerHTML =
    '<svg class="agent-widget__send-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

  form.appendChild(input);
  form.appendChild(button);

  function createTypingDots(): DocumentFragment {
    const frag = document.createDocumentFragment();
    const wrap = document.createElement('span');
    wrap.className = 'agent-widget__typing-dots';
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'agent-widget__typing-dot';
      wrap.appendChild(dot);
    }
    frag.appendChild(wrap);
    return frag;
  }

  function appendMessage(
    content: string,
    role: 'user' | 'assistant',
    modifier?: 'loading' | 'error'
  ): HTMLElement {
    const li = document.createElement('li');
    li.className = `agent-widget__message agent-widget__message--${role}`;
    if (modifier) {
      li.classList.add(`agent-widget__message--${modifier}`);
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'agent-widget__message-time';
    timeEl.textContent = formatMessageTime(new Date());
    li.appendChild(timeEl);

    const bodyEl = document.createElement('span');
    bodyEl.className = 'agent-widget__message-body';
    if (modifier === 'loading') {
      bodyEl.appendChild(createTypingDots());
    } else {
      bodyEl.textContent = content;
    }
    li.appendChild(bodyEl);

    messages.appendChild(li);
    const last = messages.lastElementChild as HTMLElement | null;
    if (last?.scrollIntoView) {
      last.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    return li;
  }

  function setMessageContent(li: HTMLElement, content: string): void {
    const body = li.querySelector('.agent-widget__message-body');
    if (body) {
      body.textContent = content;
    }
    li.classList.remove('agent-widget__message--loading', 'agent-widget__message--error');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      return;
    }

    appendMessage(value, 'user');
    input.value = '';
    input.focus();

    const loadingLi = appendMessage('…', 'assistant', 'loading');
    button.disabled = true;
    input.disabled = true;

    try {
      const token = getAuthToken();
      const impersonationId = getImpersonationId();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (impersonationId) {
        headers[IMPERSONATION_HEADER] = impersonationId;
      }

      const res = await fetch(chatApiUrl, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          conversationId,
          message: value,
          ...(token ? { accessToken: token } : {})
        })
      });

      const data = (await res.json()) as AgentChatResponse | { message?: string };

      if (!res.ok) {
        const errMsg =
          (data && typeof (data as { message?: string }).message === 'string')
            ? (data as { message: string }).message
            : 'Something went wrong. Please try again.';
        setMessageContent(loadingLi, errMsg);
        loadingLi.classList.add('agent-widget__message--error');
        return;
      }

      const answer =
        typeof (data as AgentChatResponse).answer === 'string'
          ? (data as AgentChatResponse).answer
          : 'No response.';
      setMessageContent(loadingLi, answer);
    } catch {
      setMessageContent(loadingLi, 'Unable to reach the agent. Please try again.');
      loadingLi.classList.add('agent-widget__message--error');
    } finally {
      button.disabled = false;
      input.disabled = false;
    }
  });

  launcher.addEventListener('click', () => {
    const isOpen = widget.classList.contains(CHATBOX_OPEN_CLASS);
    widget.classList.toggle(CHATBOX_OPEN_CLASS, !isOpen);

    if (!isOpen) {
      input.focus();
    }
  });

  closeButton.addEventListener('click', () => {
    widget.classList.remove(CHATBOX_OPEN_CLASS);
  });

  panel.appendChild(header);
  panel.appendChild(messages);
  panel.appendChild(form);
  widget.appendChild(launcher);
  widget.appendChild(panel);

  container.appendChild(widget);
}

function injectWidgetStyles() {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    @keyframes agent-widget-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-4px); }
    }
    @keyframes agent-widget-panel-open {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    .agent-widget {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    }
    .agent-widget__launcher {
      width: 56px;
      height: 56px;
      border: none;
      border-radius: 999px;
      background: linear-gradient(145deg, #0f1320 0%, #0b0d17 100%);
      box-shadow: 0 8px 24px rgba(11, 13, 23, 0.4), 0 0 0 1px rgba(255,255,255,0.06) inset;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .agent-widget__launcher:hover {
      transform: scale(1.04);
      box-shadow: 0 12px 28px rgba(11, 13, 23, 0.45);
    }
    .agent-widget__launcher:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__launcher-icon {
      width: 32px;
      height: 32px;
      display: block;
    }
    .agent-widget__panel {
      display: none;
      width: 380px;
      max-width: 100%;
      height: 420px;
      max-height: 85vh;
      background: linear-gradient(180deg, #f8fafd 0%, #f0f4fa 100%);
      border-radius: 20px;
      box-shadow: 0 20px 56px rgba(11, 13, 23, 0.18), 0 0 0 1px rgba(11, 13, 23, 0.06);
      overflow: hidden;
      margin: 0 0 16px 16px;
      flex-direction: column;
      flex-shrink: 0;
      transform-origin: left bottom;
    }
    .agent-widget--open .agent-widget__panel {
      display: flex;
      animation: agent-widget-panel-open 0.22s ease-out forwards;
    }
    .agent-widget--open .agent-widget__launcher {
      display: none;
    }
    .agent-widget__header {
      flex-shrink: 0;
      padding: 12px 12px 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: linear-gradient(180deg, rgba(255,255,255,0.95) 0%, transparent 100%);
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
    }
    .agent-widget__header-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      display: block;
      object-fit: contain;
    }
    .agent-widget__header-content {
      min-width: 0;
      flex: 1;
    }
    .agent-widget__title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #0b0d17;
      letter-spacing: -0.01em;
    }
    .agent-widget__subtitle {
      margin: 2px 0 0;
      font-size: 11px;
      color: #5c6470;
    }
    .agent-widget__close {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__close:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__close:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__messages {
      list-style: none;
      margin: 0;
      padding: 10px 12px;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .agent-widget__messages::-webkit-scrollbar {
      display: none;
    }
    .agent-widget__message {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.4;
      max-width: 88%;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .agent-widget__message-time {
      font-size: 9px;
      opacity: 0.82;
      letter-spacing: 0.02em;
    }
    .agent-widget__message--user .agent-widget__message-time {
      color: rgba(255,255,255,0.85);
    }
    .agent-widget__message--assistant .agent-widget__message-time {
      color: #5c6470;
    }
    .agent-widget__message-body {
      word-break: break-word;
    }
    .agent-widget__message--welcome .agent-widget__message-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-widget__welcome-intro {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
    }
    .agent-widget__suggestions {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .agent-widget__suggestions li {
      margin: 0;
    }
    .agent-widget__suggestion-chip {
      display: inline-block;
      padding: 6px 10px;
      font-size: 11px;
      line-height: 1.3;
      color: #1a5de8;
      background: rgba(47, 123, 255, 0.1);
      border: 1px solid rgba(47, 123, 255, 0.25);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .agent-widget__suggestion-chip:hover {
      background: rgba(47, 123, 255, 0.18);
      border-color: rgba(47, 123, 255, 0.4);
      color: #0f1320;
    }
    .agent-widget__suggestion-chip:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__message--user {
      background: linear-gradient(145deg, #0f1320 0%, #0b0d17 100%);
      color: #fff;
      align-self: flex-end;
      max-width: 88%;
      border-bottom-right-radius: 6px;
    }
    .agent-widget__message--assistant {
      background: #fff;
      color: #1a1d24;
      align-self: stretch;
      width: 100%;
      max-width: 100%;
      border: 1px solid rgba(11, 13, 23, 0.08);
      border-bottom-left-radius: 6px;
    }
    .agent-widget__message--loading {
      padding: 10px 14px;
    }
    .agent-widget__typing-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .agent-widget__typing-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #5c6470;
      animation: agent-widget-bounce 1.2s ease-in-out infinite;
    }
    .agent-widget__typing-dot:nth-child(1) { animation-delay: 0s; }
    .agent-widget__typing-dot:nth-child(2) { animation-delay: 0.15s; }
    .agent-widget__typing-dot:nth-child(3) { animation-delay: 0.3s; }
    .agent-widget__message--error {
      background: #fef2f2;
      color: #991b1b;
      border-color: rgba(153, 27, 27, 0.2);
    }
    .agent-widget__form {
      flex-shrink: 0;
      padding: 10px 12px 12px;
      border-top: 1px solid rgba(11, 13, 23, 0.08);
      display: flex;
      gap: 10px;
      background: rgba(255,255,255,0.6);
    }
    .agent-widget__input {
      flex: 1;
      border: 1px solid rgba(11, 13, 23, 0.12);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 12px;
      background: #fff;
      color: #0b0d17;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .agent-widget__input::placeholder {
      color: #7d8592;
    }
    .agent-widget__input:focus {
      outline: none;
      border-color: #3d7aff;
      box-shadow: 0 0 0 3px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__input:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .agent-widget__send {
      border: none;
      border-radius: 10px;
      background: linear-gradient(145deg, #2f7bff 0%, #1a5de8 100%);
      color: #fff;
      padding: 0;
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .agent-widget__send-icon {
      display: block;
    }
    .agent-widget__send:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(47, 123, 255, 0.35);
    }
    .agent-widget__send:active:not(:disabled) {
      transform: translateY(0);
    }
    .agent-widget__send:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__send:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
  `;

  document.head.appendChild(style);
}

function resolveGhostIconPath() {
  const widgetScript = document.querySelector<HTMLScriptElement>(
    'script[data-agent-widget-script]'
  );

  if (widgetScript?.src) {
    try {
      return new URL('./asset/ghost.svg', widgetScript.src).toString();
    } catch {}
  }

  return GHOST_ICON_PATH;
}
