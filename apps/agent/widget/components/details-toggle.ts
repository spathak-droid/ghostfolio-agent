import { buildDetailsContent } from './json-details';
import type { AgentChatResponse } from '../types';

export function appendDetailsToggle(
  li: HTMLElement,
  response: AgentChatResponse,
  detailsStore: WeakMap<HTMLElement, AgentChatResponse>
): void {
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

  detailsStore.set(li, response);

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
    const responseToShow = detailsStore.get(li);
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
