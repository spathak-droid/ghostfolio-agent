/** UTC date and timestamp for prompts; avoids timezone bugs. */
export function getUtcContext(): { todayUtc: string; nowUtc: string } {
  const nowUtc = new Date().toISOString();
  return { todayUtc: nowUtc.slice(0, 10), nowUtc };
}

export function parseFlexibleNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Used only when the LLM is unavailable (no client, API error, or no content). Do not use when the LLM has returned an answer—let the LLM decide. */
export function fallbackDirectAnswer(message: string) {
  const normalized = message.toLowerCase();

  // Context-specific fallback for jokes
  if (normalized.includes('joke')) {
    return 'Here\'s a finance joke: Why did the stock broker go to the beach? To find some liquid assets!';
  }

  // Greeting-aware fallback
  if (isGreetingMessage(message)) {
    return 'Hi! I can help with portfolio, market data, and transaction questions. Ask me about holdings, allocation, buy dates, or entry prices.';
  }

  // Generic fallback
  return 'I can help with portfolio, market data, and transaction questions. Ask me about holdings, allocation, buy dates, or entry prices.';
}

function isGreetingMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return ['hello', 'hi', 'hey', 'yo', 'sup', 'good morning', 'good afternoon', 'good evening'].includes(normalized);
}

/** Only used when LLM is unavailable; do not call when the LLM has returned an answer. */
export function enforceGreetingCapabilityAnswer(message: string, answer: string): string {
  if (!isGreetingMessage(message)) {
    return answer;
  }

  if (answer.toLowerCase().includes('help')) {
    return answer;
  }

  return fallbackDirectAnswer(message);
}

function isFinanceScopedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  const financeKeywords = [
    'finance',
    'financial',
    'portfolio',
    'allocation',
    'market',
    'price',
    'stock',
    'crypto',
    'bitcoin',
    'transaction',
    'buy',
    'sell',
    'holding',
    'holdings',
    'performance',
    'return',
    'invest',
    'ticker',
    'dividend',
    'fee',
    'interest',
    'liability',
    'loan',
    'debt',
    'balance'
  ];

  return financeKeywords.some((keyword) => normalized.includes(keyword));
}

export function enforceFinanceScopeAnswer(message: string, answer: string): string {
  if (isGreetingMessage(message)) {
    return enforceGreetingCapabilityAnswer(message, answer);
  }

  if (isFinanceScopedMessage(message)) {
    return answer;
  }

  return fallbackDirectAnswer(message);
}

export function extractMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object') {
          const textValue = (item as Record<string, unknown>).text;
          return typeof textValue === 'string' ? textValue : '';
        }

        return '';
      })
      .join('')
      .trim();

    return joined.length > 0 ? joined : undefined;
  }

  if (content && typeof content === 'object') {
    const textValue = (content as Record<string, unknown>).text;
    if (typeof textValue === 'string') {
      const trimmed = textValue.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }

  return undefined;
}

export function normalizeStructuredMarkdown(input: string): string {
  if (!input.trim()) {
    return input;
  }

  const normalizedLines: string[] = [];
  let previousWasHeading = false;
  for (const rawLine of input.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    const isHeading = /^##\s+/.test(line);

    if (isHeading && normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== '') {
      normalizedLines.push('');
    }
    if (line === '' && previousWasHeading) {
      continue;
    }
    let normalizedLine = line;
    if (/^##\s+/.test(normalizedLine)) {
      normalizedLine = normalizedLine.replace(/^##\s+/, '').trim();
      if (!normalizedLine.endsWith(':')) {
        normalizedLine = `${normalizedLine}:`;
      }
    } else if (/^\*\s+/.test(normalizedLine)) {
      normalizedLine = normalizedLine.replace(/^\*\s+/, '- ');
    } else if (/^\s*\*\s+/.test(normalizedLine)) {
      normalizedLine = normalizedLine.replace(/^\s*\*\s+/, '  - ');
    }
    normalizedLines.push(normalizedLine);
    previousWasHeading = isHeading;
  }

  return normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function isValidAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
