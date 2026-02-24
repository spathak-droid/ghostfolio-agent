const AGENT_WIDGET_MOUNTED_ATTR = 'data-ghostfolio-agent-mounted';
const CHATBOX_OPEN_CLASS = 'agent-widget--open';
const GHOST_ICON_PATH = '/widget/asset/ghost.svg';
const STYLE_ELEMENT_ID = 'ghostfolio-agent-widget-style';

export function mountChatWidget(container: HTMLElement) {
  if (!container || container.hasAttribute(AGENT_WIDGET_MOUNTED_ATTR)) {
    return;
  }

  injectWidgetStyles();
  container.setAttribute(AGENT_WIDGET_MOUNTED_ATTR, 'true');

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
  header.appendChild(headerContent);
  header.appendChild(closeButton);

  const messages = document.createElement('ul');
  messages.className = 'agent-widget__messages';

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
  button.innerText = 'Send';

  form.appendChild(input);
  form.appendChild(button);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();

    if (!value) {
      return;
    }

    const messageItem = document.createElement('li');
    messageItem.className =
      'agent-widget__message agent-widget__message--user';
    messageItem.textContent = value;

    messages.appendChild(messageItem);
    input.value = '';
    input.focus();

    const lastMessage = messages.lastElementChild as HTMLElement | null;

    if (lastMessage && typeof lastMessage.scrollIntoView === 'function') {
      lastMessage.scrollIntoView();
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
    .agent-widget {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: flex-start;
      font-family: Arial, sans-serif;
    }
    .agent-widget__launcher {
      width: 56px;
      height: 56px;
      border: none;
      border-radius: 999px;
      background: #0b0d17;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .agent-widget__launcher-icon {
      width: 32px;
      height: 32px;
      display: block;
    }
    .agent-widget__panel {
      display: none;
      width: min(360px, 100%);
      max-height: min(520px, 100%);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.2);
      overflow: hidden;
      margin-right: 12px;
      margin-left: 0;
    }
    .agent-widget--open .agent-widget__panel {
      display: flex;
      flex-direction: column;
    }
    .agent-widget--open .agent-widget__launcher {
      display: none;
    }
    .agent-widget__header {
      padding: 12px 14px 6px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .agent-widget__header-content {
      min-width: 0;
    }
    .agent-widget__title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
    }
    .agent-widget__subtitle {
      margin: 4px 0 0;
      font-size: 12px;
      color: #666;
    }
    .agent-widget__close {
      border: none;
      background: transparent;
      color: #666;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .agent-widget__messages {
      list-style: none;
      margin: 0;
      padding: 8px 14px;
      min-height: 140px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agent-widget__message {
      padding: 8px 10px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.35;
      max-width: 90%;
    }
    .agent-widget__message--user {
      background: #0b0d17;
      color: #fff;
      align-self: flex-end;
    }
    .agent-widget__form {
      padding: 10px;
      border-top: 1px solid #eee;
      display: flex;
      gap: 8px;
    }
    .agent-widget__input {
      flex: 1;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 8px;
      font-size: 13px;
    }
    .agent-widget__send {
      border: none;
      border-radius: 8px;
      background: #0b0d17;
      color: #fff;
      padding: 0 12px;
      font-size: 13px;
      cursor: pointer;
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
      const url = new URL(widgetScript.src);
      return `${url.origin}/widget/asset/ghost.svg`;
    } catch {}
  }

  return GHOST_ICON_PATH;
}
