const AGENT_WIDGET_MOUNTED_ATTR = 'data-ghostfolio-agent-mounted';
const CHATBOX_OPEN_CLASS = 'agent-widget--open';
const GHOST_ICON_PATH = '/widget/asset/ghost.svg';
const STYLE_ELEMENT_ID = 'ghostfolio-agent-widget-style';
const CHAT_API_PATH = '/api/v1/agent/chat';
const FEEDBACK_API_PATH = '/feedback';
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

interface AgentToolCall {
  toolName: string;
  success: boolean;
  result: Record<string, unknown>;
}

interface TrendChartPoint {
  date: string;
  price: number;
}

interface HoldingTrendPayload {
  chart?: {
    points?: TrendChartPoint[];
    range?: string;
  };
  performance?: {
    currentPrice?: number;
    periodChange?: number;
    periodChangePercent?: number;
    sinceEntryChange?: number;
    sinceEntryChangePercent?: number;
  };
}

interface SymbolOption {
  dataSource?: string;
  label: string;
  symbol: string;
}

interface WidgetCreateOrderParams {
  dataSource?: string;
  symbol: string;
}

interface AgentVerification {
  confidence: number;
  flags?: string[];
  isValid: boolean;
}

interface AgentConversationMessage {
  role: 'assistant' | 'user';
  content: string;
}

interface AgentTraceStep {
  type: 'llm' | 'tool';
  name: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: unknown;
}

interface AgentLatency {
  llmMs: number;
  toolMs: number;
  totalMs: number;
}

interface AgentChatResponse {
  answer: string;
  conversation?: AgentConversationMessage[];
  errors?: { code: string; message: string; recoverable: boolean }[];
  latency?: AgentLatency;
  toolCalls?: AgentToolCall[];
  trace?: AgentTraceStep[];
  verification?: AgentVerification;
}

const messageDetailsStore = new WeakMap<HTMLElement, AgentChatResponse>();

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

function resolveFeedbackApiUrl(chatApiUrl: string): string {
  if (chatApiUrl.endsWith(CHAT_API_PATH)) {
    return chatApiUrl.slice(0, -CHAT_API_PATH.length) + '/api/v1/agent/feedback';
  }
  if (chatApiUrl.endsWith('/chat')) {
    return chatApiUrl.slice(0, -'/chat'.length) + '/feedback';
  }
  return FEEDBACK_API_PATH;
}

function resolveClearConversationApiUrl(chatApiUrl: string): string {
  if (chatApiUrl.endsWith(CHAT_API_PATH)) {
    return chatApiUrl.slice(0, -CHAT_API_PATH.length) + CHAT_API_PATH + '/clear';
  }
  if (chatApiUrl.endsWith('/chat')) {
    return chatApiUrl + '/clear';
  }
  return CHAT_API_PATH + '/clear';
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

  let currentConversationId = generateConversationId();
  const chatApiUrl = resolveChatApiUrl();
  const feedbackApiUrl = resolveFeedbackApiUrl(chatApiUrl);
  const clearApiUrl = resolveClearConversationApiUrl(chatApiUrl);

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

  const headerActions = document.createElement('div');
  headerActions.className = 'agent-widget__header-actions';

  const newChatButton = document.createElement('button');
  newChatButton.type = 'button';
  newChatButton.className = 'agent-widget__new-chat';
  newChatButton.setAttribute('aria-label', 'New chat');
  newChatButton.innerHTML = `
    <svg class="agent-widget__new-chat-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  `;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'agent-widget__close';
  closeButton.setAttribute('aria-label', 'Minimize chat');
  closeButton.textContent = '×';

  headerActions.appendChild(newChatButton);
  headerActions.appendChild(closeButton);

  headerContent.appendChild(title);
  headerContent.appendChild(subtitle);
  header.appendChild(headerIcon);
  header.appendChild(headerContent);
  header.appendChild(headerActions);

  const messages = document.createElement('ul');
  messages.className = 'agent-widget__messages';
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-label', 'Chat messages');

  const suggestions = [
    'Analyze my portfolio',
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
    'How is my Apple Stock doing?',
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

  function appendSymbolOptions(li: HTMLElement, response: AgentChatResponse): void {
    const toolCalls = response.toolCalls ?? [];
    const latestOrderCall = [...toolCalls]
      .reverse()
      .find((call) => call.toolName === 'create_order' && call.success);
    if (!latestOrderCall) {
      return;
    }

    const result = latestOrderCall.result;
    const needsClarification = result?.needsClarification === true;
    const rawOptions = result?.symbolOptions;
    if (!needsClarification || !Array.isArray(rawOptions) || rawOptions.length === 0) {
      return;
    }

    const options = rawOptions
      .filter((option): option is SymbolOption => {
        if (!option || typeof option !== 'object') return false;
        const rec = option as Record<string, unknown>;
        return typeof rec.symbol === 'string' && typeof rec.label === 'string';
      })
      .slice(0, 3);
    if (options.length === 0) {
      return;
    }

    const existing = li.querySelector('.agent-widget__symbol-options');
    if (existing) {
      existing.remove();
    }

    const container = document.createElement('div');
    container.className = 'agent-widget__symbol-options';
    const title = document.createElement('div');
    title.className = 'agent-widget__symbol-options-title';
    title.textContent = 'Select a symbol:';
    container.appendChild(title);

    const list = document.createElement('div');
    list.className = 'agent-widget__symbol-options-list';
    for (const option of options) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'agent-widget__symbol-option-chip';
      chip.textContent = option.label;
      chip.addEventListener('click', () => {
        nextCreateOrderParams = {
          dataSource: option.dataSource,
          symbol: option.symbol
        };
        input.value = option.symbol;
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      });
      list.appendChild(chip);
    }
    container.appendChild(list);
    li.appendChild(container);
  }

  const STRING_TRUNCATE_LEN = 200;

  function renderExpandableJson(value: unknown, depth = 0): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'agent-widget__json-node';

    if (value === null) {
      wrap.textContent = 'null';
      wrap.classList.add('agent-widget__json-value');
      return wrap;
    }
    if (typeof value === 'boolean') {
      wrap.textContent = value ? 'true' : 'false';
      wrap.classList.add('agent-widget__json-value');
      return wrap;
    }
    if (typeof value === 'number') {
      wrap.textContent = String(value);
      wrap.classList.add('agent-widget__json-value');
      return wrap;
    }
    if (typeof value === 'string') {
      wrap.classList.add('agent-widget__json-value');
      if (value.length <= STRING_TRUNCATE_LEN) {
        wrap.textContent = JSON.stringify(value);
      } else {
        const short = document.createElement('span');
        short.textContent = JSON.stringify(value.slice(0, STRING_TRUNCATE_LEN)) + ' …';
        const full = document.createElement('span');
        full.className = 'agent-widget__json-full';
        full.textContent = JSON.stringify(value);
        full.hidden = true;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'agent-widget__json-toggle-inline';
        toggle.textContent = ' Show more';
        toggle.addEventListener('click', () => {
          full.hidden = !full.hidden;
          toggle.textContent = full.hidden ? ' Show more' : ' Show less';
        });
        wrap.appendChild(short);
        wrap.appendChild(toggle);
        wrap.appendChild(full);
      }
      return wrap;
    }
    if (Array.isArray(value)) {
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'agent-widget__json-expand';
      header.setAttribute('aria-expanded', 'false');
      const label = document.createElement('span');
      label.className = 'agent-widget__json-key';
      label.textContent = `▶ array [${value.length}]`;
      header.appendChild(label);
      const children = document.createElement('div');
      children.className = 'agent-widget__json-children';
      children.hidden = true;
      value.forEach((item, i) => {
        const row = document.createElement('div');
        row.className = 'agent-widget__json-entry';
        const idx = document.createElement('span');
        idx.className = 'agent-widget__json-key';
        idx.textContent = `${i}: `;
        row.appendChild(idx);
        row.appendChild(renderExpandableJson(item, depth + 1));
        children.appendChild(row);
      });
      header.addEventListener('click', () => {
        const expanded = children.hidden;
        children.hidden = !expanded;
        header.setAttribute('aria-expanded', String(!expanded));
        label.textContent = (expanded ? '▼' : '▶') + ` array [${value.length}]`;
      });
      wrap.appendChild(header);
      wrap.appendChild(children);
      return wrap;
    }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'agent-widget__json-expand';
      header.setAttribute('aria-expanded', 'false');
      const label = document.createElement('span');
      label.className = 'agent-widget__json-key';
      label.textContent = `▶ object { ${keys.length} keys }`;
      header.appendChild(label);
      const children = document.createElement('div');
      children.className = 'agent-widget__json-children';
      children.hidden = true;
      keys.forEach((key) => {
        const row = document.createElement('div');
        row.className = 'agent-widget__json-entry';
        const keyEl = document.createElement('span');
        keyEl.className = 'agent-widget__json-key';
        keyEl.textContent = `${key}: `;
        row.appendChild(keyEl);
        row.appendChild(renderExpandableJson(obj[key], depth + 1));
        children.appendChild(row);
      });
      header.addEventListener('click', () => {
        const expanded = children.hidden;
        children.hidden = !expanded;
        header.setAttribute('aria-expanded', String(!expanded));
        label.textContent = (expanded ? '▼' : '▶') + ` object { ${keys.length} keys }`;
      });
      wrap.appendChild(header);
      wrap.appendChild(children);
      return wrap;
    }
    wrap.textContent = String(value);
    wrap.classList.add('agent-widget__json-value');
    return wrap;
  }

  function appendDetailsToggle(li: HTMLElement, response: AgentChatResponse): void {
    const trace = response.trace ?? [];
    const toolCalls = response.toolCalls ?? [];
    const errors = response.errors ?? [];
    const latency = response.latency;
    const verification = response.verification;
    const hasDetails =
      trace.length > 0 ||
      toolCalls.length > 0 ||
      errors.length > 0 ||
      verification != null ||
      latency != null;

    if (!hasDetails) {
      return;
    }

    messageDetailsStore.set(li, response);

    const traceBox = document.createElement('div');
    traceBox.className = 'agent-widget__trace-box';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'agent-widget__trace-btn';
    toggleBtn.setAttribute('aria-label', 'Show trace');
    toggleBtn.innerHTML = `
      <span class="agent-widget__trace-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </span>
      <span>Trace</span>
    `;

    toggleBtn.addEventListener('click', () => {
      const responseToShow = messageDetailsStore.get(li);
      if (!responseToShow) return;

      const overlay = document.createElement('div');
      overlay.className = 'agent-widget__details-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'agent-widget-details-title');

      const dialog = document.createElement('div');
      dialog.className = 'agent-widget__details-dialog';

      const header = document.createElement('div');
      header.className = 'agent-widget__details-dialog-header';
      const title = document.createElement('h3');
      title.id = 'agent-widget-details-title';
      title.className = 'agent-widget__details-dialog-title';
      title.textContent = 'Trace';
      header.appendChild(title);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'agent-widget__details-dialog-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '×';
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      const body = document.createElement('div');
      body.className = 'agent-widget__details-dialog-body';
      body.appendChild(buildDetailsContent(responseToShow));
      dialog.appendChild(body);

      overlay.appendChild(dialog);

      function closePopup() {
        overlay.remove();
        overlay.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onEscape);
      }
      function onBackdropClick(e: MouseEvent) {
        if (e.target === overlay) closePopup();
      }
      function onEscape(e: KeyboardEvent) {
        if (e.key === 'Escape') closePopup();
      }

      closeBtn.addEventListener('click', closePopup);
      overlay.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onEscape);

      document.body.appendChild(overlay);
      closeBtn.focus();
    });

    traceBox.appendChild(toggleBtn);
    li.appendChild(traceBox);
  }

  function appendHoldingTrendCard(li: HTMLElement, response: AgentChatResponse): void {
    const trendPayload = extractHoldingTrendPayload(response);
    if (!trendPayload) return;
    const points = getTrendPoints(trendPayload.chart?.points);
    if (points.length < 2) return;
    const card = createTrendCard({ points, trendPayload });
    li.appendChild(card);
  }

  function getTrendPoints(points: HoldingTrendPayload['chart']['points']): TrendChartPoint[] {
    if (!Array.isArray(points)) return [];
    return points.filter((point): point is TrendChartPoint => {
      return (
        !!point &&
        typeof point === 'object' &&
        typeof point.date === 'string' &&
        typeof point.price === 'number' &&
        Number.isFinite(point.price)
      );
    });
  }

  function createTrendCard({
    points,
    trendPayload
  }: {
    points: TrendChartPoint[];
    trendPayload: HoldingTrendPayload;
  }): HTMLElement {
    const card = document.createElement('div');
    card.className = 'agent-widget__holding-trend-card';
    const perf = trendPayload.performance ?? {};
    card.appendChild(createTrendTitle());
    card.appendChild(createTrendSummary({ perf, range: trendPayload.chart?.range ?? 'custom' }));
    card.appendChild(createTrendChart(points));
    card.appendChild(createTrendSinceEntry(perf));
    return card;
  }

  function createTrendTitle(): HTMLElement {
    const heading = document.createElement('div');
    heading.className = 'agent-widget__holding-trend-title';
    heading.textContent = 'Holding trend';
    return heading;
  }

  function createTrendSummary({
    perf,
    range
  }: {
    perf: NonNullable<HoldingTrendPayload['performance']>;
    range: string;
  }): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'agent-widget__holding-trend-summary';
    summary.textContent = `Range: ${range} | Current: ${formatMoney(perf.currentPrice)} | Period: ${formatSignedPercent(perf.periodChangePercent)}`;
    return summary;
  }

  function createTrendChart(points: TrendChartPoint[]): SVGSVGElement {
    const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chart.setAttribute('viewBox', '0 0 320 96');
    chart.setAttribute('preserveAspectRatio', 'none');
    chart.classList.add('agent-widget__trend-chart');

    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    areaPath.setAttribute('class', 'agent-widget__trend-area');
    areaPath.setAttribute('d', buildTrendPath(points, true));
    chart.appendChild(areaPath);

    const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    linePath.setAttribute('class', 'agent-widget__trend-line');
    linePath.setAttribute('d', buildTrendPath(points, false));
    chart.appendChild(linePath);
    return chart;
  }

  function createTrendSinceEntry(perf: NonNullable<HoldingTrendPayload['performance']>): HTMLElement {
    const sub = document.createElement('div');
    sub.className = 'agent-widget__holding-trend-sub';
    sub.textContent = `Since entry: ${formatSignedPercent(perf.sinceEntryChangePercent)} (${formatSignedMoney(perf.sinceEntryChange)})`;
    return sub;
  }

  function extractHoldingTrendPayload(response: AgentChatResponse): HoldingTrendPayload | null {
    const toolCalls = response.toolCalls ?? [];
    const latest = [...toolCalls]
      .reverse()
      .find((call) => call.success && call.toolName === 'analyze_stock_trend');
    if (!latest || typeof latest.result !== 'object' || latest.result == null) {
      return null;
    }
    return latest.result as HoldingTrendPayload;
  }

  function buildTrendPath(points: TrendChartPoint[], includeAreaBase: boolean): string {
    const width = 320;
    const height = 96;
    const xStep = points.length > 1 ? width / (points.length - 1) : width;
    const prices = points.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const spread = max - min || 1;

    let path = '';
    points.forEach((point, index) => {
      const x = index * xStep;
      const y = height - ((point.price - min) / spread) * (height - 6) - 3;
      path += index === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    if (includeAreaBase) {
      path += ` L ${width} ${height} L 0 ${height} Z`;
    }
    return path;
  }

  function formatMoney(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`;
  }

  function formatSignedMoney(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`;
  }

  function formatSignedPercent(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }

  function buildDetailsContent(response: AgentChatResponse): DocumentFragment {
    const frag = document.createDocumentFragment();
    const trace = response.trace ?? [];
    const toolCalls = response.toolCalls ?? [];
    const errors = response.errors ?? [];
    const latency = response.latency;
    const verification = response.verification;

    if (latency != null) {
      const section = document.createElement('div');
      section.className = 'agent-widget__details-section';
      const heading = document.createElement('div');
      heading.className = 'agent-widget__details-heading';
      heading.textContent = 'Latency';
      section.appendChild(heading);
      const line = document.createElement('div');
      line.className = 'agent-widget__verification-line';
      line.textContent = `LLM: ${latency.llmMs}ms, Tool: ${latency.toolMs}ms, Total: ${latency.totalMs}ms`;
      section.appendChild(line);
      frag.appendChild(section);
    }

    if (trace.length > 0) {
      const section = document.createElement('div');
      section.className = 'agent-widget__details-section';
      const heading = document.createElement('div');
      heading.className = 'agent-widget__details-heading';
      heading.textContent = 'Trace';
      section.appendChild(heading);
      const list = document.createElement('div');
      list.className = 'agent-widget__trace-list';
      trace.forEach((step, index) => {
        const item = document.createElement('div');
        item.className = 'agent-widget__trace-step';
        const header = document.createElement('div');
        header.className = 'agent-widget__trace-step-header';
        const indexEl = document.createElement('span');
        indexEl.className = 'agent-widget__trace-step-index';
        indexEl.textContent = `${index + 1}.`;
        const typeBadge = document.createElement('span');
        typeBadge.className =
          step.type === 'llm'
            ? 'agent-widget__trace-step-type agent-widget__trace-step-type--llm'
            : 'agent-widget__trace-step-type agent-widget__trace-step-type--tool';
        typeBadge.textContent = step.type === 'llm' ? 'LLM' : 'Tool';
        const nameEl = document.createElement('span');
        nameEl.className = 'agent-widget__trace-step-name';
        nameEl.textContent = step.name;
        header.appendChild(indexEl);
        header.appendChild(typeBadge);
        header.appendChild(nameEl);
        item.appendChild(header);
        if (step.input != null && Object.keys(step.input).length > 0) {
          const inputLabel = document.createElement('div');
          inputLabel.className = 'agent-widget__trace-step-label';
          inputLabel.textContent = 'Input';
          item.appendChild(inputLabel);
          item.appendChild(renderExpandableJson(step.input));
        }
        if (step.output !== undefined) {
          const outputLabel = document.createElement('div');
          outputLabel.className = 'agent-widget__trace-step-label';
          outputLabel.textContent = 'Output';
          item.appendChild(outputLabel);
          item.appendChild(renderExpandableJson(step.output));
        }
        list.appendChild(item);
      });
      section.appendChild(list);
      frag.appendChild(section);
    }

    if (toolCalls.length > 0) {
      const section = document.createElement('div');
      section.className = 'agent-widget__details-section';
      const heading = document.createElement('div');
      heading.className = 'agent-widget__details-heading';
      heading.textContent = 'Tool calls';
      section.appendChild(heading);
      toolCalls.forEach((call) => {
        const block = document.createElement('div');
        block.className = 'agent-widget__tool-call';
        const meta = document.createElement('div');
        meta.className = 'agent-widget__tool-meta';
        const name = document.createElement('span');
        name.className = 'agent-widget__tool-name';
        name.textContent = call.toolName;
        const badge = document.createElement('span');
        badge.className = call.success
          ? 'agent-widget__tool-badge agent-widget__tool-badge--success'
          : 'agent-widget__tool-badge agent-widget__tool-badge--fail';
        badge.textContent = call.success ? 'OK' : 'Fail';
        meta.appendChild(name);
        meta.appendChild(badge);
        block.appendChild(meta);
        const resultLabel = document.createElement('div');
        resultLabel.className = 'agent-widget__tool-result-label';
        resultLabel.textContent = 'Result';
        block.appendChild(resultLabel);
        block.appendChild(renderExpandableJson(call.result));
        section.appendChild(block);
      });
      frag.appendChild(section);
    }

    if (errors.length > 0) {
      const section = document.createElement('div');
      section.className = 'agent-widget__details-section';
      const heading = document.createElement('div');
      heading.className = 'agent-widget__details-heading';
      heading.textContent = 'Errors';
      section.appendChild(heading);
      const list = document.createElement('ul');
      list.className = 'agent-widget__errors-list';
      errors.forEach((err) => {
        const item = document.createElement('li');
        item.className = 'agent-widget__error-item';
        item.textContent = `${err.code}: ${err.message}`;
        list.appendChild(item);
      });
      section.appendChild(list);
      frag.appendChild(section);
    }

    if (verification != null) {
      const section = document.createElement('div');
      section.className = 'agent-widget__details-section';
      const heading = document.createElement('div');
      heading.className = 'agent-widget__details-heading';
      heading.textContent = 'Verification';
      section.appendChild(heading);
      const line = document.createElement('div');
      line.className = 'agent-widget__verification-line';
      const flags = verification.flags?.length ? verification.flags.join(', ') : '—';
      line.textContent = `Confidence: ${verification.confidence}, Valid: ${verification.isValid ? 'yes' : 'no'}, Flags: ${flags}`;
      section.appendChild(line);
      frag.appendChild(section);
    }

    const rawSection = document.createElement('div');
    rawSection.className = 'agent-widget__details-section';
    const rawHeading = document.createElement('div');
    rawHeading.className = 'agent-widget__details-heading';
    rawHeading.textContent = 'Raw response';
    rawSection.appendChild(rawHeading);
    rawSection.appendChild(renderExpandableJson(response));
    frag.appendChild(rawSection);

    return frag;
  }

  function appendFeedbackControls(
    li: HTMLElement,
    response: AgentChatResponse,
    userMessage: string
  ): void {
    if (typeof response.answer !== 'string' || response.answer.trim().length === 0) {
      return;
    }

    const box = document.createElement('div');
    box.className = 'agent-widget__feedback-box';

    const label = document.createElement('span');
    label.className = 'agent-widget__feedback-label';
    label.textContent = 'Was this helpful?';
    box.appendChild(label);

    const status = document.createElement('span');
    status.className = 'agent-widget__feedback-status';

    const thumbsUp = document.createElement('button');
    thumbsUp.type = 'button';
    thumbsUp.className = 'agent-widget__feedback-btn';
    thumbsUp.setAttribute('aria-label', 'Helpful response');
    thumbsUp.textContent = '👍';

    const thumbsDown = document.createElement('button');
    thumbsDown.type = 'button';
    thumbsDown.className = 'agent-widget__feedback-btn';
    thumbsDown.setAttribute('aria-label', 'Not helpful response');
    thumbsDown.textContent = '👎';

    const disableControls = () => {
      thumbsUp.disabled = true;
      thumbsDown.disabled = true;
    };

    const promptForCorrection = (): Promise<string | undefined> =>
      new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'agent-widget__details-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'agent-widget-correction-title');

        const dialog = document.createElement('div');
        dialog.className =
          'agent-widget__details-dialog agent-widget__correction-dialog';

        const header = document.createElement('div');
        header.className = 'agent-widget__details-dialog-header';
        const title = document.createElement('h3');
        title.id = 'agent-widget-correction-title';
        title.className = 'agent-widget__details-dialog-title';
        title.textContent = 'How should I improve this answer?';
        header.appendChild(title);
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'agent-widget__details-dialog-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        header.appendChild(closeBtn);
        dialog.appendChild(header);

        const body = document.createElement('div');
        body.className = 'agent-widget__details-dialog-body';
        const textarea = document.createElement('textarea');
        textarea.className = 'agent-widget__correction-textarea';
        textarea.placeholder = 'Optional: add a better answer...';
        textarea.rows = 4;
        body.appendChild(textarea);

        const actions = document.createElement('div');
        actions.className = 'agent-widget__correction-actions';
        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'agent-widget__correction-btn agent-widget__correction-btn--ghost';
        skipBtn.textContent = 'Skip';
        const submitBtn = document.createElement('button');
        submitBtn.type = 'button';
        submitBtn.className = 'agent-widget__correction-btn';
        submitBtn.textContent = 'Submit';
        actions.appendChild(skipBtn);
        actions.appendChild(submitBtn);
        body.appendChild(actions);
        dialog.appendChild(body);
        overlay.appendChild(dialog);

        const cleanup = () => {
          overlay.removeEventListener('click', onBackdropClick);
          document.removeEventListener('keydown', onEscape);
          overlay.remove();
        };
        const finish = (value: string | undefined) => {
          cleanup();
          resolve(value);
        };
        const onBackdropClick = (e: MouseEvent) => {
          if (e.target === overlay) {
            finish(undefined);
          }
        };
        const onEscape = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            finish(undefined);
          }
        };

        closeBtn.addEventListener('click', () => finish(undefined));
        skipBtn.addEventListener('click', () => finish(undefined));
        submitBtn.addEventListener('click', () => {
          const trimmed = textarea.value.trim();
          finish(trimmed.length > 0 ? trimmed : undefined);
        });
        overlay.addEventListener('click', onBackdropClick);
        document.addEventListener('keydown', onEscape);

        document.body.appendChild(overlay);
        textarea.focus();
      });

    const submitFeedback = async (rating: 'up' | 'down') => {
      const correction =
        rating === 'down'
          ? await promptForCorrection()
          : undefined;
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
        const result = await fetch(feedbackApiUrl, {
          method: 'POST',
          headers,
          credentials: 'same-origin',
          body: JSON.stringify({
            answer: response.answer,
            conversationId: currentConversationId,
            latency: response.latency,
            message: userMessage,
            ...(correction && correction.trim().length > 0
              ? { correction: correction.trim() }
              : {}),
            rating,
            trace: response.trace
          })
        });
        if (result.ok) {
          status.textContent = 'Thanks for your feedback.';
          disableControls();
        } else {
          status.textContent = 'Could not submit feedback.';
        }
      } catch {
        status.textContent = 'Could not submit feedback.';
      }
    };

    thumbsUp.addEventListener('click', () => {
      void submitFeedback('up');
    });
    thumbsDown.addEventListener('click', () => {
      void submitFeedback('down');
    });

    box.appendChild(thumbsUp);
    box.appendChild(thumbsDown);
    box.appendChild(status);
    li.appendChild(box);
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
        setMessageContent(loadingLi, errMsg);
        loadingLi.classList.add('agent-widget__message--error');
        return;
      }

      const answer =
        typeof (data as AgentChatResponse).answer === 'string'
          ? (data as AgentChatResponse).answer
          : 'No response.';
      setMessageContent(loadingLi, answer);
      if (res.ok) {
        appendHoldingTrendCard(loadingLi, data as AgentChatResponse);
        appendSymbolOptions(loadingLi, data as AgentChatResponse);
        appendDetailsToggle(loadingLi, data as AgentChatResponse);
        appendFeedbackControls(loadingLi, data as AgentChatResponse, value);
      }
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

  newChatButton.addEventListener('click', async () => {
    const conversationIdToClear = currentConversationId;
    currentConversationId = generateConversationId();
    nextCreateOrderParams = undefined;
    messages.innerHTML = '';
    messages.appendChild(createWelcomeMessage());
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
  panel.appendChild(messages);
  const formWrap = document.createElement('div');
  formWrap.className = 'agent-widget__form-wrap';
  formWrap.appendChild(popover);
  formWrap.appendChild(form);
  panel.appendChild(formWrap);
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
      font-size: 12px;
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
    .agent-widget__header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .agent-widget__new-chat {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      padding: 0;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__new-chat:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__new-chat:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
    }
    .agent-widget__new-chat-icon {
      display: block;
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
      white-space: pre-line;
    }
    .agent-widget__symbol-options {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(15, 19, 32, 0.08);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .agent-widget__symbol-options-title {
      font-size: 10px;
      color: #5c6470;
    }
    .agent-widget__symbol-options-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .agent-widget__symbol-option-chip {
      border: 1px solid rgba(47, 123, 255, 0.25);
      background: rgba(47, 123, 255, 0.1);
      color: #1a5de8;
      border-radius: 10px;
      font-size: 11px;
      line-height: 1.2;
      padding: 4px 8px;
      cursor: pointer;
    }
    .agent-widget__symbol-option-chip:hover {
      background: rgba(47, 123, 255, 0.16);
    }
    .agent-widget__symbol-option-chip:focus-visible {
      outline: 2px solid #3d7aff;
      outline-offset: 2px;
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
      width: 100%;
      padding: 10px 12px 12px;
      border-top: 1px solid rgba(11, 13, 23, 0.08);
      display: flex;
      gap: 10px;
      align-items: center;
      background: rgba(255,255,255,0.6);
    }
    .agent-widget__form-wrap {
      position: relative;
      flex-shrink: 0;
      width: 100%;
    }
    .agent-widget__form-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-width: 0;
    }
    .agent-widget__plus-trigger {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 1px solid rgba(11, 13, 23, 0.12);
      background: #fff;
      color: #0b0d17;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .agent-widget__plus-trigger:hover {
      border-color: #3d7aff;
      box-shadow: 0 0 0 2px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__plus-trigger:focus-visible {
      outline: none;
      border-color: #3d7aff;
      box-shadow: 0 0 0 3px rgba(61, 122, 255, 0.2);
    }
    .agent-widget__plus-trigger-icon {
      display: block;
    }
    .agent-widget__suggestions-popover {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 6px;
      display: none;
      max-height: 140px;
      overflow-y: auto;
      background: #fff;
      border: 1px solid rgba(11, 13, 23, 0.12);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(11, 13, 23, 0.12);
      overflow-x: hidden;
      z-index: 10;
    }
    .agent-widget__suggestions-popover.agent-widget__suggestions-popover--open {
      display: block;
    }
    .agent-widget__suggestions-popover-item {
      display: block;
      width: 100%;
      padding: 10px 12px;
      border: none;
      background: none;
      color: #0b0d17;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .agent-widget__suggestions-popover-item:hover {
      background: rgba(61, 122, 255, 0.08);
    }
    .agent-widget__suggestions-popover-item:not(:last-child) {
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
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
    .agent-widget__trace-box {
      margin-top: 8px;
      padding: 6px 10px;
      border: 1px solid rgba(11, 13, 23, 0.1);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.8);
      align-self: flex-start;
    }
    .agent-widget__feedback-box {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(15, 19, 32, 0.08);
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .agent-widget__feedback-label {
      font-size: 10px;
      color: #5c6470;
      margin-right: 2px;
    }
    .agent-widget__feedback-btn {
      border: 1px solid rgba(11, 13, 23, 0.12);
      background: #fff;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 4px 6px;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .agent-widget__feedback-btn:hover:not(:disabled) {
      background: #f8fafd;
      border-color: rgba(11, 13, 23, 0.2);
    }
    .agent-widget__feedback-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .agent-widget__feedback-status {
      font-size: 10px;
      color: #16a34a;
    }
    .agent-widget__correction-dialog {
      max-width: 420px;
      max-height: 70vh;
    }
    .agent-widget__correction-textarea {
      width: 100%;
      border: 1px solid rgba(11, 13, 23, 0.12);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      resize: vertical;
      box-sizing: border-box;
      font-family: inherit;
      color: #0b0d17;
      background: #fff;
    }
    .agent-widget__correction-actions {
      margin-top: 10px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .agent-widget__correction-btn {
      border: none;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      background: #1a5de8;
      color: #fff;
    }
    .agent-widget__correction-btn--ghost {
      background: #fff;
      color: #0b0d17;
      border: 1px solid rgba(11, 13, 23, 0.12);
    }
    .agent-widget__trace-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: none;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 500;
      color: #fff;
      background: #22c55e;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .agent-widget__trace-btn:hover {
      background: #16a34a;
    }
    .agent-widget__trace-btn:focus-visible {
      outline: 2px solid #22c55e;
      outline-offset: 2px;
    }
    .agent-widget__trace-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .agent-widget__trace-icon svg {
      display: block;
    }
    .agent-widget__details-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(11, 13, 23, 0.4);
      animation: agent-widget-fade-in 0.15s ease-out;
    }
    @keyframes agent-widget-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .agent-widget__details-dialog {
      width: 100%;
      max-width: 480px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 24px 48px rgba(11, 13, 23, 0.2);
      overflow: hidden;
      animation: agent-widget-dialog-in 0.2s ease-out;
    }
    @keyframes agent-widget-dialog-in {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
    .agent-widget__details-dialog-header {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(11, 13, 23, 0.08);
      background: #f8fafd;
    }
    .agent-widget__details-dialog-title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #0b0d17;
    }
    .agent-widget__details-dialog-close {
      border: none;
      background: transparent;
      color: #5c6470;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      padding: 0;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .agent-widget__details-dialog-close:hover {
      background: rgba(11, 13, 23, 0.06);
      color: #0b0d17;
    }
    .agent-widget__details-dialog-body {
      padding: 12px 16px;
      overflow-y: auto;
      max-height: 60vh;
      font-size: 11px;
    }
    .agent-widget__details-section {
      margin-bottom: 10px;
    }
    .agent-widget__details-section:last-child {
      margin-bottom: 0;
    }
    .agent-widget__trace-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-widget__trace-step {
      padding: 8px 10px;
      border: 1px solid rgba(11, 13, 23, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.6);
    }
    .agent-widget__trace-step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    .agent-widget__trace-step-index {
      font-size: 10px;
      color: #5c6470;
      font-weight: 600;
    }
    .agent-widget__trace-step-type {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .agent-widget__trace-step-type--llm {
      background: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
    }
    .agent-widget__trace-step-type--tool {
      background: rgba(34, 197, 94, 0.15);
      color: #15803d;
    }
    .agent-widget__trace-step-name {
      font-family: ui-monospace, monospace;
      font-size: 11px;
      font-weight: 500;
      color: #0b0d17;
    }
    .agent-widget__trace-step-label {
      font-size: 10px;
      color: #5c6470;
      margin-top: 4px;
      margin-bottom: 2px;
    }
    .agent-widget__details-heading {
      font-weight: 600;
      color: #0b0d17;
      margin-bottom: 4px;
    }
    .agent-widget__tool-call {
      margin-bottom: 8px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(11, 13, 23, 0.06);
    }
    .agent-widget__tool-call:last-child {
      border-bottom: none;
    }
    .agent-widget__tool-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .agent-widget__tool-name {
      font-family: ui-monospace, monospace;
      font-weight: 500;
      color: #0b0d17;
    }
    .agent-widget__tool-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 6px;
      font-weight: 500;
    }
    .agent-widget__tool-badge--success {
      background: rgba(34, 197, 94, 0.15);
      color: #15803d;
    }
    .agent-widget__tool-badge--fail {
      background: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
    }
    .agent-widget__tool-result-label {
      font-size: 10px;
      color: #5c6470;
      margin-bottom: 2px;
    }
    .agent-widget__errors-list {
      margin: 0;
      padding-left: 16px;
      color: #991b1b;
    }
    .agent-widget__error-item {
      margin-bottom: 2px;
    }
    .agent-widget__verification-line {
      font-size: 11px;
      color: #5c6470;
    }
    .agent-widget__details-dialog-body [hidden] {
      display: none !important;
    }
    .agent-widget__json-node {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      line-height: 1.25;
      color: #1a1d24;
      margin: 0;
    }
    .agent-widget__json-expand {
      display: block;
      width: 100%;
      text-align: left;
      padding: 0;
      margin: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }
    .agent-widget__json-expand:hover {
      color: #1a5de8;
    }
    .agent-widget__json-key {
      color: #5c6470;
    }
    .agent-widget__json-children {
      padding-left: 12px;
      border-left: 1px solid rgba(11, 13, 23, 0.1);
      margin-top: 1px;
    }
    .agent-widget__json-entry {
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin-bottom: 2px;
      line-height: 1.25;
    }
    .agent-widget__json-entry:last-child {
      margin-bottom: 0;
    }
    .agent-widget__json-entry > .agent-widget__json-node {
      flex: 0 1 auto;
      min-width: 0;
    }
    .agent-widget__json-value {
      word-break: break-word;
    }
    .agent-widget__json-toggle-inline {
      padding: 0;
      margin-left: 4px;
      border: none;
      background: transparent;
      font-size: 10px;
      color: #1a5de8;
      cursor: pointer;
      text-decoration: underline;
    }
    .agent-widget__json-full {
      display: block;
      margin-top: 4px;
    }
    .agent-widget__holding-trend-card {
      margin-top: 10px;
      border: 1px solid rgba(26, 93, 232, 0.18);
      border-radius: 10px;
      background: linear-gradient(180deg, rgba(26, 93, 232, 0.08), rgba(26, 93, 232, 0.02));
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .agent-widget__holding-trend-title {
      font-size: 11px;
      font-weight: 700;
      color: #dbeafe;
      letter-spacing: 0.02em;
    }
    .agent-widget__holding-trend-summary,
    .agent-widget__holding-trend-sub {
      font-size: 10px;
      color: #cbd5e1;
      line-height: 1.35;
    }
    .agent-widget__trend-chart {
      width: 100%;
      height: 96px;
      display: block;
      border-radius: 8px;
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.38), rgba(15, 23, 42, 0.12));
      overflow: hidden;
    }
    .agent-widget__trend-area {
      fill: rgba(45, 212, 191, 0.18);
      stroke: none;
    }
    .agent-widget__trend-line {
      fill: none;
      stroke: #2dd4bf;
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
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
