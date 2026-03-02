import {
  AGENT_WIDGET_MOUNTED_ATTR,
  CHATBOX_OPEN_CLASS,
  IMPERSONATION_HEADER
} from './utils/constants';
import { injectWidgetStyles } from './styles';
import { clearAuthToken, getAuthToken, getImpersonationId } from './auth';
import {
  generateConversationId,
  resolveAcknowledgeApiUrl,
  resolveAuthApiUrl,
  resolveChatApiUrl,
  resolveClearConversationApiUrl,
  resolveFeedbackApiUrl,
  resolveGhostIconPath,
  resolveHistoryApiUrl,
  resolveHistoryItemApiUrl
} from './utils/urls';
import { formatMessageTime } from './utils/format';
import {
  createTypingDots,
  setAckContent,
  setMessageContent
} from './utils/chat-message';
import { appendSymbolOptions as appendSymbolOptionsToMessage } from './utils/symbol-options';
import type {
  AgentChatResponse,
  WidgetCreateOrderParams
} from './types';
import { createWelcomeMessage as buildWelcomeMessage } from './components/welcome';
import { createSignInCard } from './components/sign-in';
import {
  createTrendCard,
  extractHoldingTrendPayload,
  getTrendPoints
} from './components/trend';
import { appendDetailsToggle } from './components/details-toggle';
import { appendFeedbackControls } from './components/feedback';

const messageDetailsStore = new WeakMap<HTMLElement, AgentChatResponse>();

export function mountChatWidget(container: HTMLElement) {
  if (!container || container.hasAttribute(AGENT_WIDGET_MOUNTED_ATTR)) {
    return;
  }

  injectWidgetStyles();
  container.setAttribute(AGENT_WIDGET_MOUNTED_ATTR, 'true');

  let currentConversationId = generateConversationId();
  const chatApiUrl = resolveChatApiUrl();
  const acknowledgeApiUrl = resolveAcknowledgeApiUrl(chatApiUrl);
  let ackRotationIntervalId: ReturnType<typeof setInterval> | null = null;
  const clearAckRotation = (): void => {
    if (ackRotationIntervalId !== null) {
      clearInterval(ackRotationIntervalId);
      ackRotationIntervalId = null;
    }
  };
  const authApiUrl = resolveAuthApiUrl();
  const feedbackApiUrl = resolveFeedbackApiUrl(chatApiUrl);
  const clearApiUrl = resolveClearConversationApiUrl(chatApiUrl);
  const historyApiUrl = resolveHistoryApiUrl(chatApiUrl);

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
  // subtitle.textContent = 'Your Portfolio Agent';

  const headerActions = document.createElement('div');
  headerActions.className = 'agent-widget__header-actions';

  const newChatButton = document.createElement('button');
  newChatButton.type = 'button';
  newChatButton.className = 'agent-widget__new-chat';
  newChatButton.setAttribute('aria-label', 'New chat');
  newChatButton.innerHTML = `
    <svg class="agent-widget__new-chat-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <line x1="12" y1="8" x2="12" y2="14"/>
      <line x1="9" y1="11" x2="15" y2="11"/>
    </svg>
  `;

  const historyButton = document.createElement('button');
  historyButton.type = 'button';
  historyButton.className = 'agent-widget__history-btn';
  historyButton.setAttribute('aria-label', 'Chat history');
  historyButton.setAttribute('aria-expanded', 'false');
  historyButton.setAttribute('aria-haspopup', 'true');
  historyButton.innerHTML = `
    <svg class="agent-widget__history-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 8v4l2 2"/>
      <circle cx="12" cy="12" r="10"/>
    </svg>
  `;

  const historyDropdown = document.createElement('div');
  historyDropdown.className = 'agent-widget__history-dropdown';
  historyDropdown.setAttribute('role', 'listbox');
  historyDropdown.setAttribute('aria-label', 'Past conversations');
  historyDropdown.hidden = true;

  const signOutButton = document.createElement('button');
  signOutButton.type = 'button';
  signOutButton.className = 'agent-widget__sign-out';
  signOutButton.setAttribute('aria-label', 'Sign out');
  signOutButton.innerHTML = `
    <svg class="agent-widget__sign-out-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  `;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'agent-widget__close';
  closeButton.setAttribute('aria-label', 'Minimize chat');
  closeButton.textContent = '×';

  headerActions.appendChild(signOutButton);
  headerActions.appendChild(historyButton);
  headerActions.appendChild(newChatButton);
  headerActions.appendChild(closeButton);

  headerContent.appendChild(title);
  // headerContent.appendChild(subtitle);
  header.appendChild(headerIcon);
  header.appendChild(headerContent);
  header.appendChild(headerActions);
  header.appendChild(historyDropdown);

  const signInView = document.createElement('div');
  signInView.className = 'agent-widget__sign-in-view';
  signInView.setAttribute('aria-label', 'Sign in to chat');

  const messages = document.createElement('ul');
  messages.className = 'agent-widget__messages';
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-label', 'Chat messages');

  const formWrap = document.createElement('div');
  formWrap.className = 'agent-widget__form-wrap';

  const suggestions = [
    'Analyze my portfolio',
    'Help categorize my transactions',
    'Summarize my portfolio allocation'
  ] as const;

  function createWelcomeMessage(): HTMLElement {
    return buildWelcomeMessage({
      formatTime: formatMessageTime,
      onSuggestionClick: (label) => {
        input.value = label;
        input.focus();
      },
      suggestions
    });
  }

  function renderInitialContent(): void {
    if (getAuthToken()) {
      launcher.style.display = '';
      signInView.style.display = 'none';
      signInView.innerHTML = '';
      messages.style.display = '';
      messages.innerHTML = '';
      messages.appendChild(createWelcomeMessage());
      formWrap.classList.remove('agent-widget__form-wrap--hidden');
      newChatButton.style.display = '';
      signOutButton.style.display = '';
      historyButton.style.display = '';
    } else {
      launcher.style.display = '';
      signInView.innerHTML = '';
      signInView.appendChild(
        createSignInCard(authApiUrl, () => renderInitialContent())
      );
      signInView.style.display = 'flex';
      messages.style.display = 'none';
      messages.innerHTML = '';
      formWrap.classList.add('agent-widget__form-wrap--hidden');
      newChatButton.style.display = 'none';
      signOutButton.style.display = 'none';
      historyButton.style.display = 'none';
      historyDropdown.hidden = true;
    }
  }

  renderInitialContent();

  // Refresh widget when user logs in or out from the client (dashboard, OAuth, register, etc.)
  window.addEventListener('ghostfolio-auth-changed', () => {
    renderInitialContent();
  });

  const form = document.createElement('form');
  form.className = 'agent-widget__form';
  form.setAttribute('aria-label', 'Chat with the finance agent');
  let nextCreateOrderParams: WidgetCreateOrderParams | undefined;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Tell me something about your portfolio';
  input.autocomplete = 'off';
  input.className = 'agent-widget__input';

  const plusTrigger = document.createElement('button');
  plusTrigger.type = 'button';
  plusTrigger.className = 'agent-widget__plus-trigger';
  plusTrigger.setAttribute('aria-label', 'Suggested questions');
  plusTrigger.setAttribute('aria-expanded', 'false');
  plusTrigger.setAttribute('aria-haspopup', 'true');
  plusTrigger.innerHTML = `
    <svg class="agent-widget__plus-trigger-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 5v14"/><path d="M5 12h14"/>
    </svg>
  `;

  const formRow = document.createElement('div');
  formRow.className = 'agent-widget__form-row';

  const quickSuggestions = [
    'Analyze my account risk',
    'Can you buy me Bitcoin Shares',
    'What is my top performing coin?',
    'What is the current price of Apple?',
    'What did i buy last year?'
  ] as const;

  const popover = document.createElement('div');
  popover.className = 'agent-widget__suggestions-popover';
  popover.setAttribute('role', 'listbox');
  popover.setAttribute('aria-label', 'Suggested questions');
  for (const text of quickSuggestions) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'agent-widget__suggestions-popover-item';
    option.textContent = text;
    option.setAttribute('role', 'option');
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      input.value = text;
      input.focus();
      popover.classList.remove('agent-widget__suggestions-popover--open');
      plusTrigger.setAttribute('aria-expanded', 'false');
    });
    popover.appendChild(option);
  }

  function setPopoverOpen(open: boolean): void {
    if (open) {
      popover.classList.add('agent-widget__suggestions-popover--open');
      plusTrigger.setAttribute('aria-expanded', 'true');
    } else {
      popover.classList.remove('agent-widget__suggestions-popover--open');
      plusTrigger.setAttribute('aria-expanded', 'false');
    }
  }

  plusTrigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = popover.classList.contains('agent-widget__suggestions-popover--open');
    setPopoverOpen(!isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!popover.classList.contains('agent-widget__suggestions-popover--open')) return;
    const target = e.target as Node;
    if (!popover.contains(target) && !plusTrigger.contains(target)) {
      setPopoverOpen(false);
    }
  });

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'agent-widget__send';
  button.setAttribute('aria-label', 'Send');
  button.innerHTML =
    '<svg class="agent-widget__send-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

  formRow.appendChild(plusTrigger);
  formRow.appendChild(input);
  formRow.appendChild(button);
  form.appendChild(formRow);

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

  function appendSymbolOptions(li: HTMLElement, response: AgentChatResponse): void {
    appendSymbolOptionsToMessage(li, response, (params) => {
      nextCreateOrderParams = params;
      input.value = params.symbol;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }

  function appendHoldingTrendCard(li: HTMLElement, response: AgentChatResponse): void {
    const trendPayload = extractHoldingTrendPayload(response);
    if (!trendPayload) return;
    const points = getTrendPoints(trendPayload.chart?.points);
    if (points.length < 2) return;
    const card = createTrendCard({ points, trendPayload });
    li.appendChild(card);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      return;
    }

    clearAckRotation();
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

      // Fire-and-forget: get a quick acknowledgment from the LLM (~300ms)
      // Shown in grey with moving dots; ack text replaces dots, full answer replaces when /chat responds
      fetch(acknowledgeApiUrl, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ conversationId: currentConversationId, message: value })
      })
        .then((r) => r.json())
        .then((ack: { forWidget?: string | string[] }) => {
          const raw = ack?.forWidget;
          if (raw == null) return;
          const messages = Array.isArray(raw) ? raw : [raw];
          if (messages.length === 0) return;
          setAckContent(loadingLi, messages[0]);
          if (messages.length > 1) {
            clearAckRotation();
            let index = 1;
            ackRotationIntervalId = setInterval(() => {
              setAckContent(loadingLi, messages[index % messages.length]);
              index += 1;
            }, 2300);
          }
        })
        .catch(() => undefined); // non-critical: widget still works without acknowledgment

      const res = await fetch(chatApiUrl, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          conversationId: currentConversationId,
          ...(nextCreateOrderParams ? { createOrderParams: nextCreateOrderParams } : {}),
          message: value
        })
      });
      nextCreateOrderParams = undefined;

      const data = (await res.json()) as AgentChatResponse | { message?: string };

      if (!res.ok) {
        const errMsg =
          (data && typeof (data as { message?: string }).message === 'string')
            ? (data as { message: string }).message
            : 'Something went wrong. Please try again.';
        clearAckRotation();
        setMessageContent(loadingLi, errMsg);
        loadingLi.classList.add('agent-widget__message--error');
        return;
      }

      const answer =
        typeof (data as AgentChatResponse).answer === 'string'
          ? (data as AgentChatResponse).answer
          : 'No response.';
      clearAckRotation();
      setMessageContent(loadingLi, answer);
      if (res.ok) {
        appendHoldingTrendCard(loadingLi, data as AgentChatResponse);
        appendSymbolOptions(loadingLi, data as AgentChatResponse);
        appendDetailsToggle(loadingLi, data as AgentChatResponse, messageDetailsStore);
        appendFeedbackControls(loadingLi, data as AgentChatResponse, value, {
          feedbackApiUrl,
          conversationId: currentConversationId
        });
      }
    } catch {
      clearAckRotation();
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
      if (getAuthToken()) prefetchHistory();
      input.focus();
    }
  });

  closeButton.addEventListener('click', () => {
    widget.classList.remove(CHATBOX_OPEN_CLASS);
  });

  signOutButton.addEventListener('click', () => {
    clearAuthToken();
    renderInitialContent();
  });

  function showHistoryLoading(): void {
    historyDropdown.innerHTML = '';
    historyDropdown.appendChild(
      Object.assign(document.createElement('div'), {
        className: 'agent-widget__history-loading',
        textContent: 'Loading…'
      })
    );
    historyDropdown.hidden = false;
    historyButton.setAttribute('aria-expanded', 'true');
  }

  let cachedHistoryList: { id: string; title: string | null; updatedAt: string }[] | null = null;

  function getHistoryHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = getAuthToken();
    const impersonationId = getImpersonationId();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (impersonationId) headers[IMPERSONATION_HEADER] = impersonationId;
    return headers;
  }

  function prefetchHistory(): void {
    fetch(historyApiUrl, { headers: getHistoryHeaders(), credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data: { conversations?: { id: string; title: string | null; updatedAt: string }[] }) => {
        cachedHistoryList = data.conversations ?? [];
      })
      .catch(() => {
        cachedHistoryList = [];
      });
  }

  function renderHistoryList(list: { id: string; title: string | null; updatedAt: string }[]): void {
    historyDropdown.innerHTML = '';
    if (list.length === 0) {
      historyDropdown.appendChild(
        Object.assign(document.createElement('div'), {
          className: 'agent-widget__history-empty',
          textContent: 'No past conversations'
        })
      );
      return;
    }
    const headers = getHistoryHeaders();
    for (const conv of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'agent-widget__history-item';
      btn.setAttribute('role', 'option');
      const title = conv.title?.trim() || 'Conversation';
      const titleText = title.length > 60 ? title.slice(0, 57) + '…' : title;
      const updated = conv.updatedAt ? formatMessageTime(new Date(conv.updatedAt)) : '';
      const titleEl = document.createElement('span');
      titleEl.className = 'agent-widget__history-item-title';
      titleEl.textContent = titleText;
      btn.appendChild(titleEl);
      const sub = document.createElement('span');
      sub.className = 'agent-widget__history-item-date';
      sub.textContent = updated;
      btn.appendChild(sub);
      btn.title = title;
      btn.addEventListener('click', () => loadHistoryConversation(conv.id, headers));
      historyDropdown.appendChild(btn);
    }
  }

  async function loadHistoryConversation(
    conversationId: string,
    headers: Record<string, string>
  ): Promise<void> {
    historyDropdown.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
    const itemUrl = resolveHistoryItemApiUrl(chatApiUrl, conversationId);
    const r = await fetch(itemUrl, { headers, credentials: 'same-origin' });
    if (!r.ok) return;
    const item = (await r.json()) as {
      id: string;
      messages: { content: string; role: 'user' | 'assistant' }[];
    };
    currentConversationId = item.id;
    nextCreateOrderParams = undefined;
    messages.innerHTML = '';
    for (const msg of item.messages ?? []) {
      appendMessage(msg.content, msg.role);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  historyButton.addEventListener('click', async () => {
    if (historyDropdown.hidden) {
      if (cachedHistoryList !== null) {
        renderHistoryList(cachedHistoryList);
        historyDropdown.hidden = false;
        historyButton.setAttribute('aria-expanded', 'true');
      } else {
        showHistoryLoading();
        try {
          const res = await fetch(historyApiUrl, {
            headers: getHistoryHeaders(),
            credentials: 'same-origin'
          });
          const data = (await res.json()) as {
            conversations?: { id: string; title: string | null; updatedAt: string }[];
          };
          cachedHistoryList = data.conversations ?? [];
          renderHistoryList(cachedHistoryList);
        } catch {
          historyDropdown.innerHTML = '';
          historyDropdown.appendChild(
            Object.assign(document.createElement('div'), {
              className: 'agent-widget__history-empty',
              textContent: 'Could not load history'
            })
          );
        }
      }
    } else {
      historyDropdown.hidden = true;
      historyButton.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (
      historyDropdown && !historyDropdown.hidden &&
      !historyDropdown.contains(target) && !historyButton.contains(target)
    ) {
      historyDropdown.hidden = true;
      historyButton.setAttribute('aria-expanded', 'false');
    }
  });

  newChatButton.addEventListener('click', async () => {
    const conversationIdToClear = currentConversationId;
    currentConversationId = generateConversationId();
    nextCreateOrderParams = undefined;
    cachedHistoryList = null;
    renderInitialContent();
    messages.scrollTop = 0;
    const token = getAuthToken();
    const impersonationId = getImpersonationId();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (impersonationId) {
      headers[IMPERSONATION_HEADER] = impersonationId;
    }
    try {
      await fetch(clearApiUrl, {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ conversationId: conversationIdToClear })
      });
    } catch {
      // Best-effort clear: UI already reset; server state may remain until TTL
    }
  });

  panel.appendChild(header);
  panel.appendChild(signInView);
  panel.appendChild(messages);
  formWrap.appendChild(popover);
  formWrap.appendChild(form);
  panel.appendChild(formWrap);
  widget.appendChild(launcher);
  widget.appendChild(panel);

  container.appendChild(widget);
}

