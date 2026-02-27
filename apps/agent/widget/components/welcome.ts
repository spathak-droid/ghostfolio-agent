import { formatMessageTime } from '../utils/format';

const WELCOME_INTRO =
  "Hi, I'm your Ghostfolio agent. I can help you analyze your portfolio, look up market data, and categorize transactions. Try one of the suggestions below or ask anything.";

export function createWelcomeMessage({
  formatTime = formatMessageTime,
  onSuggestionClick,
  suggestions
}: {
  formatTime?: (date: Date) => string;
  onSuggestionClick: (label: string) => void;
  suggestions: readonly string[];
}): HTMLElement {
  const li = document.createElement('li');
  li.className =
    'agent-widget__message agent-widget__message--assistant agent-widget__message--welcome';

  const timeEl = document.createElement('span');
  timeEl.className = 'agent-widget__message-time';
  timeEl.textContent = formatTime(new Date());
  li.appendChild(timeEl);

  const body = document.createElement('div');
  body.className = 'agent-widget__message-body';

  const intro = document.createElement('p');
  intro.className = 'agent-widget__welcome-intro';
  intro.textContent = WELCOME_INTRO;
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
    chip.addEventListener('click', () => onSuggestionClick(label));
    item.appendChild(chip);
    list.appendChild(item);
  }
  body.appendChild(list);
  li.appendChild(body);
  return li;
}
