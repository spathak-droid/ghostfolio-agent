/**
 * Pure DOM helpers for chat message elements (typing dots, loading spinner, body content).
 * Used by the chat widget when appending and updating assistant messages.
 */

export function createTypingDots(): DocumentFragment {
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

export function createLoadingSpinner(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'agent-widget__message-loading-spinner';
  span.setAttribute('aria-hidden', 'true');
  span.setAttribute('aria-label', 'Loading');
  return span;
}

export function setMessageContent(li: HTMLElement, content: string): void {
  const bodyWrap = li.querySelector('.agent-widget__message-body-wrap');
  const body = bodyWrap
    ? bodyWrap.querySelector('.agent-widget__message-body')
    : li.querySelector('.agent-widget__message-body');
  if (body) {
    body.textContent = content;
  }
  const spinner = li.querySelector('.agent-widget__message-loading-spinner');
  if (spinner) {
    spinner.remove();
  }
  li.classList.remove('agent-widget__message--loading', 'agent-widget__message--error');
}

/**
 * Sets acknowledge placeholder text and shows green spinner on the right until final answer.
 */
export function setAckContent(li: HTMLElement, content: string): void {
  const body = li.querySelector('.agent-widget__message-body');
  if (body) {
    body.textContent = content;
  }
  if (li.querySelector('.agent-widget__message-loading-spinner')) {
    return;
  }
  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'agent-widget__message-body-wrap';
  const existingBody = li.querySelector('.agent-widget__message-body');
  if (existingBody) {
    bodyWrap.appendChild(existingBody);
    bodyWrap.appendChild(createLoadingSpinner());
    li.appendChild(bodyWrap);
  }
}
