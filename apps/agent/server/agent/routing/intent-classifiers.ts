/**
 * Intent classifiers: Pure functions that detect user intent from message text.
 * All functions are stateless and used in routing decisions.
 */

export function isExplicitFactComplianceIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const hasFactIntent =
    /\bfact check\b/.test(normalized) ||
    /\bfact-check\b/.test(normalized) ||
    /\bverify\b/.test(normalized) ||
    /\bdouble check\b/.test(normalized) ||
    /\bdouble-check\b/.test(normalized) ||
    /\bcross-check\b/.test(normalized) ||
    /\bconfirm price\b/.test(normalized);
  const hasComplianceIntent =
    /\bcompliance\b/.test(normalized) ||
    /\bcompliance check\b/.test(normalized) ||
    /\bcheck .*compliance\b/.test(normalized) ||
    /\bcompliant\b/.test(normalized) ||
    /\bregulation\b/.test(normalized) ||
    /\bpolicy check\b/.test(normalized) ||
    /\bis this compliant\b/.test(normalized);

  return hasFactIntent && hasComplianceIntent;
}

export function isExplicitComplianceCheckIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    /\bcompliance check\b/.test(normalized) ||
    /\bcheck .*compliance\b/.test(normalized) ||
    /\bcheck .*regulation\b/.test(normalized) ||
    /\bregulatory check\b/.test(normalized) ||
    /\bpolicy check\b/.test(normalized) ||
    /\bis this compliant\b/.test(normalized)
  );
}

export function messageMatchesRetrievalPatterns(message: string): boolean {
  const normalized = message.toLowerCase();
  if (/\b(20\d{2})\b/.test(message)) return true;
  if (/\b(last week|last month|last year|ytd|today|yesterday)\b/.test(normalized)) return true;
  if (/\b(price|quote|cost|return|performance)\b/.test(normalized)) return true;
  if (/\b[A-Z]{1,5}\b/.test(message)) return true;
  if (/\b(btc|bitcoin|eth|ethereum)\b/.test(normalized)) return true;
  return false;
}

export function isExplicitOrderExecutionIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  const advisoryPatterns = [
    /\bshould i\s+(buy|sell)\b/,
    /\b(do you think|would you)\b.*\b(buy|sell)\b/,
    /\bis it (a )?good (idea )?to\s+(buy|sell)\b/,
    /\bbuy or sell\b/,
    /\bcan i\s+(buy|sell)\b/
  ];
  if (advisoryPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (/^(buy|sell)\b/.test(normalized)) {
    return !normalized.includes('?');
  }

  return [
    /\bcan you\s+(buy|sell)\b/,
    /\b(i want to|i'd like to|please)\s+(buy|sell)\b/,
    /\b(add|record)\s+(a\s+)?(buy|sell)\b/,
    /\b(add|record)\s+(a\s+)?(dividend|divident|fee|interest|liability|liabilty|liablity|mortgage|loan|debt)\b/,
    /\b(buy)\s+(a\s+)?(liability|liabilty|liablity)\b/,
    /\b(place|execute|submit|create|update)\s+(an?\s+)?order\b/,
    /\b(add|record)\s+(an?\s+)?activity\b/,
    /\b(buy|sell)\s+\d+(\.\d+)?\s+[a-z0-9.-]+\b/
  ].some((pattern) => pattern.test(normalized));
}

function isSmallTalk(message: string) {
  const normalized = message.trim().toLowerCase();
  return [
    'hello',
    'hi',
    'hey',
    'yo',
    'sup',
    'thanks',
    'thank you',
    'good morning',
    'good afternoon',
    'good evening',
    'how are you'
  ].includes(normalized);
}

export function classifyIntent(message: string): 'finance' | 'general' {
  if (isSmallTalk(message)) {
    return 'general';
  }

  return hasFinanceEntityOrAction(message) ? 'finance' : 'general';
}

function hasFinanceEntityOrAction(message: string) {
  const normalized = message.toLowerCase();
  if (
    /\b(add|record|create|buy|sell)\b.*\b(order|activity|dividend|divident|fee|interest|liability|liabilty|liablity|mortgage|loan|debt)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  const financeKeywords = [
    'portfolio',
    'allocation',
    'market',
    'price',
    'stock',
    'crypto',
    'bitcoin',
    'btc',
    'tsla',
    'tesla',
    'aapl',
    'nvda',
    'transaction',
    'buy',
    'sell',
    'dividend',
    'divident',
    'fee',
    'holding',
    'holdings',
    'p&l',
    'performance',
    'return',
    'invest',
    'tax',
    'taxes',
    'capital gains',
    'dividend',
    'coin',
    'compliance',
    'regulation',
    'balance',
    'account',
    'cash',
    'interest',
    'liability',
    'liabilty',
    'liablity',
    'mortgage',
    'loan',
    'debt',
    'ticker'
  ];

  return financeKeywords.some((keyword) => normalized.includes(keyword));
}

/**
 * Detect and measure prompt injection/jailbreak attempt severity.
 * Returns the actual financial intent after stripping injection patterns.
 */
export function stripPromptInjectionAndExtractIntent(message: string): string {
  // Common jailbreak/injection patterns
  const injectionPatterns = [
    /^(ignore|disregard|bypass|forget|override|discard|disrupt|violate)[\s\w]+(prior\s+)?(instruction|rule|guideline|constraint|policy|restriction|check|limit|safeguard)/i,
    /^(you should|forget about|pretend|act like|behave as if|imagine|simulate|roleplay)[\s\w]+(that you can|that you)\s+(can|will|must|should)/i,
    /^(reveal|show|output|display|expose|leak|print|dump|release)\s+(system prompt|instructions|rules|constraints|hidden|secret|internal)/i,
    /(disregard|ignore|violate)\s+(compliance|regulation|policy|rule|check)/i,
    /(and don't|don't|but don't)\s+(mention|say|include|check|verify|validate|output)/i
  ];

  const normalized = message.toLowerCase();
  const hasInjection = injectionPatterns.some(pattern => pattern.test(normalized));

  if (!hasInjection) {
    return message;
  }

  // Extract the actual financial intent by removing injection prefix
  // Pattern: "[injection], then [actual intent]" or "[injection], [actual intent]"
  const afterComma = message.split(/[,;] then | then /i).pop() || message;
  const afterThen = afterComma.split(/,\s*(?!and)/)[0].trim();

  // If extraction resulted in something reasonable, use it
  if (afterThen && afterThen.length > 3 && hasFinanceEntityOrAction(afterThen)) {
    return afterThen;
  }

  // Otherwise, try to extract just the verb+noun part
  // e.g., "Ignore restrictions. Show my holdings breakdown" -> "Show my holdings breakdown"
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const actualIntent = sentences[sentences.length - 1]?.trim() || message;

  return actualIntent.length > 3 ? actualIntent : message;
}
