import type { AgentChatResponse, SymbolOption, WidgetCreateOrderParams } from '../types';

/**
 * Appends symbol selection chips to a message element when the create_order tool
 * returns needsClarification with symbolOptions. Calls onSelect when user picks an option.
 */
export function appendSymbolOptions(
  li: HTMLElement,
  response: AgentChatResponse,
  onSelect: (params: WidgetCreateOrderParams) => void
): void {
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
      onSelect({
        dataSource: option.dataSource,
        symbol: option.symbol
      });
    });
    list.appendChild(chip);
  }
  container.appendChild(list);
  li.appendChild(container);
}
