export const MAX_MESSAGE_LENGTH = 32_000;
export const MAX_CONVERSATION_ID_LENGTH = 256;
export const TAKE_MIN = 1;
export const TAKE_MAX = 1000;
export const MAX_TOKEN_LENGTH = 8192;
export const MAX_ARRAY_LENGTH = 50;
export const MAX_STRING_FIELD_LENGTH = 32;
export const MAX_COMMENT_LENGTH = 512;
export const MAX_IMPERSONATION_ID_LENGTH = 128;
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_MONETARY_VALUE = 1_000_000_000_000_000;

export const IMPERSONATION_ID_PATTERN = /^[A-Za-z0-9-]+$/;
export const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T.+)?$/;
export const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const ORDER_TYPES = [
  'BUY',
  'SELL',
  'DIVIDEND',
  'FEE',
  'INTEREST',
  'LIABILITY'
] as const;
export const RANGE_VALUES = ['1d', 'wtd', 'mtd', 'ytd', '1y', '5y', 'max'] as const;
export const DATA_SOURCE_PATTERN = /^[A-Z0-9_]{2,32}$/;
export const CURRENCY_PATTERN = /^[A-Z]{3,10}$/;
export const SYMBOL_PATTERN = /^[A-Za-z0-9.\-_: ]{1,32}$/;
export const METRIC_VALUES = ['price'] as const;

export const CHAT_BODY_ALLOWED_KEYS = new Set([
  'accessToken',
  'conversationId',
  'createOrderParams',
  'dateFrom',
  'dateTo',
  'message',
  'metrics',
  'regulations',
  'range',
  'symbol',
  'symbols',
  'take',
  'type',
  'wantsLatest'
]);

export const CREATE_ORDER_ALLOWED_KEYS = new Set([
  'accountId',
  'comment',
  'currency',
  'dataSource',
  'date',
  'fee',
  'quantity',
  'symbol',
  'type',
  'unitPrice'
]);

export const CLEAR_CHAT_BODY_ALLOWED_KEYS = new Set(['accessToken', 'conversationId']);

export const FEEDBACK_ALLOWED_KEYS = new Set([
  'accessToken',
  'answer',
  'conversationId',
  'correction',
  'latency',
  'message',
  'rating',
  'trace'
]);

export const FEEDBACK_RATING_VALUES = ['up', 'down'] as const;
export const MAX_FEEDBACK_TEXT_LENGTH = 4000;

export const CHAT_VALIDATION = {
  MAX_MESSAGE_LENGTH,
  MAX_CONVERSATION_ID_LENGTH,
  MAX_TOKEN_LENGTH,
  TAKE_MIN,
  TAKE_MAX
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/**
 * Returns the impersonationId only if it matches IMPERSONATION_ID_PATTERN and
 * contains no control characters. Returns undefined otherwise.
 * Use this before setting any HTTP header with an impersonation ID value.
 */
export function safeImpersonationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IMPERSONATION_ID_LENGTH) return undefined;
  if (hasControlCharacters(trimmed)) return undefined;
  if (!IMPERSONATION_ID_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function hasDisallowedFeedbackControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) {
      return false;
    }
    return code < 32 || code === 127;
  });
}

export function optionalDate(value: unknown): string | undefined {
  const dateText = typeof value === 'string' ? value.trim() : undefined;
  if (!dateText || !YYYY_MM_DD.test(dateText)) {
    return undefined;
  }

  const parsed = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  const normalized = parsed.toISOString().slice(0, 10);
  return normalized === dateText ? dateText : undefined;
}

export function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function safePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function isIsoDateLike(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}
