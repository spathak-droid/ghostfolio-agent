/**
 * Purpose: Validate POST /chat request body at the HTTP boundary.
 * Inputs: raw request body (unknown); outputs validated primitive fields or 400 error.
 * Failure modes: missing/invalid message or conversationId, out-of-range take, bad date format, oversized token/arrays.
 */

const MAX_MESSAGE_LENGTH = 32_000;
const MAX_CONVERSATION_ID_LENGTH = 256;
const TAKE_MIN = 1;
const TAKE_MAX = 1000;
const MAX_TOKEN_LENGTH = 8192;
const MAX_ARRAY_LENGTH = 50;
const MAX_STRING_FIELD_LENGTH = 32;
const MAX_COMMENT_LENGTH = 512;
const MAX_IMPERSONATION_ID_LENGTH = 128;
const MAX_QUANTITY = 1_000_000_000;
const MAX_MONETARY_VALUE = 1_000_000_000_000_000;
const IMPERSONATION_ID_PATTERN = /^[A-Za-z0-9-]+$/;

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T.+)?$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ORDER_TYPES = ['BUY', 'SELL', 'DIVIDEND', 'FEE', 'INTEREST', 'LIABILITY'] as const;
const RANGE_VALUES = ['1d', 'wtd', 'mtd', 'ytd', '1y', '5y', 'max'] as const;
const DATA_SOURCE_PATTERN = /^[A-Z0-9_]{2,32}$/;
const CURRENCY_PATTERN = /^[A-Z]{3,10}$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-_:]{1,32}$/;
const METRIC_VALUES = ['price'] as const;

const CHAT_BODY_ALLOWED_KEYS = new Set([
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

const CREATE_ORDER_ALLOWED_KEYS = new Set([
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

export const CHAT_VALIDATION = {
  MAX_MESSAGE_LENGTH,
  MAX_CONVERSATION_ID_LENGTH,
  MAX_TOKEN_LENGTH,
  TAKE_MIN,
  TAKE_MAX
} as const;

export interface ValidatedChatBody {
  message: string;
  conversationId: string;
  dateFrom?: string;
  dateTo?: string;
  metrics?: string[];
  regulations?: string[];
  range?: string;
  symbol?: string;
  symbols?: string[];
  take?: number;
  type?: string;
  wantsLatest?: boolean;
}

export type ValidateChatBodyResult =
  | { ok: true; params: ValidatedChatBody }
  | { ok: false; status: 400; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function optionalDate(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : undefined;
  if (!s) return undefined;
  if (!YYYY_MM_DD.test(s)) return undefined;

  const date = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  const normalized = date.toISOString().slice(0, 10);
  return normalized === s ? s : undefined;
}

/**
 * Validates /chat body. Returns validated params or a 400 error payload.
 * Does not validate token (done in handler after normalizeAuthToken).
 */
export function validateChatBody(body: unknown): ValidateChatBodyResult {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }
  const unknownKeys = Object.keys(body).filter((key) => !CHAT_BODY_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Unknown request field(s): ${unknownKeys.join(', ')}.`
    };
  }

  const rawMessage = body.message;
  if (rawMessage === undefined || rawMessage === null) {
    return { ok: false, status: 400, error: 'message is required.' };
  }
  if (typeof rawMessage !== 'string') {
    return { ok: false, status: 400, error: 'message must be a string.' };
  }
  const message = rawMessage.trim();
  if (message.length === 0) {
    return { ok: false, status: 400, error: 'message must not be empty.' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `message must be at most ${MAX_MESSAGE_LENGTH} characters.`
    };
  }
  if (hasControlCharacters(message)) {
    return {
      ok: false,
      status: 400,
      error: 'message must not contain control characters.'
    };
  }

  const rawConversationId = body.conversationId;
  if (rawConversationId === undefined || rawConversationId === null) {
    return { ok: false, status: 400, error: 'conversationId is required.' };
  }
  if (typeof rawConversationId !== 'string') {
    return { ok: false, status: 400, error: 'conversationId must be a string.' };
  }
  const conversationId = rawConversationId.trim();
  if (conversationId.length === 0) {
    return { ok: false, status: 400, error: 'conversationId must not be empty.' };
  }
  if (conversationId.length > MAX_CONVERSATION_ID_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `conversationId must be at most ${MAX_CONVERSATION_ID_LENGTH} characters.`
    };
  }
  if (hasControlCharacters(conversationId)) {
    return {
      ok: false,
      status: 400,
      error: 'conversationId must not contain control characters.'
    };
  }

  const take = body.take;
  if (take !== undefined && take !== null) {
    if (typeof take !== 'number' || !Number.isFinite(take)) {
      return { ok: false, status: 400, error: 'take must be a number.' };
    }
    const takeInt = Math.floor(take);
    if (takeInt < TAKE_MIN || takeInt > TAKE_MAX) {
      return {
        ok: false,
        status: 400,
        error: `take must be between ${TAKE_MIN} and ${TAKE_MAX}.`
      };
    }
  }

  const dateFrom = optionalDate(body.dateFrom);
  if (body.dateFrom !== undefined && body.dateFrom !== null && dateFrom === undefined && typeof body.dateFrom === 'string' && body.dateFrom.trim().length > 0) {
    return { ok: false, status: 400, error: 'dateFrom must be YYYY-MM-DD.' };
  }
  const dateTo = optionalDate(body.dateTo);
  if (body.dateTo !== undefined && body.dateTo !== null && dateTo === undefined && typeof body.dateTo === 'string' && body.dateTo.trim().length > 0) {
    return { ok: false, status: 400, error: 'dateTo must be YYYY-MM-DD.' };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return {
      ok: false,
      status: 400,
      error: 'dateFrom must be before or equal to dateTo.'
    };
  }

  let symbols: string[] | undefined;
  if (Array.isArray(body.symbols)) {
    if (!body.symbols.every((item: unknown) => typeof item === 'string')) {
      return { ok: false, status: 400, error: 'symbols must contain only strings.' };
    }
    if (body.symbols.length > MAX_ARRAY_LENGTH) {
      return { ok: false, status: 400, error: `symbols must have at most ${MAX_ARRAY_LENGTH} items.` };
    }
    const trimmed = body.symbols.map((s) => s.trim()).filter((s) => s.length > 0);
    if (trimmed.some((s) => s.length > MAX_STRING_FIELD_LENGTH || !SYMBOL_PATTERN.test(s))) {
      return { ok: false, status: 400, error: `Each symbol must match ${SYMBOL_PATTERN.toString()}.` };
    }
    symbols = trimmed.length > 0 ? trimmed : undefined;
  }

  let metrics: string[] | undefined;
  if (Array.isArray(body.metrics)) {
    if (!body.metrics.every((item: unknown) => typeof item === 'string')) {
      return { ok: false, status: 400, error: 'metrics must contain only strings.' };
    }
    if (body.metrics.length > MAX_ARRAY_LENGTH) {
      return { ok: false, status: 400, error: `metrics must have at most ${MAX_ARRAY_LENGTH} items.` };
    }
    const trimmed = body.metrics.map((s) => s.trim()).filter((s) => s.length > 0);
    if (trimmed.some((s) => s.length > MAX_STRING_FIELD_LENGTH)) {
      return { ok: false, status: 400, error: `Each metric must be at most ${MAX_STRING_FIELD_LENGTH} characters.` };
    }
    if (
      trimmed.some(
        (metric) => !METRIC_VALUES.includes(metric as (typeof METRIC_VALUES)[number])
      )
    ) {
      return {
        ok: false,
        status: 400,
        error: `metrics must be one of ${METRIC_VALUES.join(', ')}.`
      };
    }
    metrics = trimmed.length > 0 ? trimmed : undefined;
  }

  let regulations: string[] | undefined;
  if (Array.isArray(body.regulations)) {
    if (!body.regulations.every((item: unknown) => typeof item === 'string')) {
      return { ok: false, status: 400, error: 'regulations must contain only strings.' };
    }
    if (body.regulations.length > MAX_ARRAY_LENGTH) {
      return {
        ok: false,
        status: 400,
        error: `regulations must have at most ${MAX_ARRAY_LENGTH} items.`
      };
    }
    const trimmed = body.regulations.map((s) => s.trim()).filter((s) => s.length > 0);
    if (trimmed.some((s) => s.length > MAX_STRING_FIELD_LENGTH * 2)) {
      return {
        ok: false,
        status: 400,
        error: `Each regulation must be at most ${MAX_STRING_FIELD_LENGTH * 2} characters.`
      };
    }
    regulations = trimmed.length > 0 ? trimmed : undefined;
  }

  const range = trimString(body.range);
  if (range && !RANGE_VALUES.includes(range as (typeof RANGE_VALUES)[number])) {
    return {
      ok: false,
      status: 400,
      error: `range must be one of ${RANGE_VALUES.join(', ')}.`
    };
  }
  const symbol = trimString(body.symbol);
  if (symbol !== undefined && (symbol.length > MAX_STRING_FIELD_LENGTH || !SYMBOL_PATTERN.test(symbol))) {
    return { ok: false, status: 400, error: `symbol must match ${SYMBOL_PATTERN.toString()}.` };
  }
  const type = trimString(body.type);
  if (type && !ORDER_TYPES.includes(type as (typeof ORDER_TYPES)[number])) {
    return {
      ok: false,
      status: 400,
      error: `type must be one of ${ORDER_TYPES.join(', ')}.`
    };
  }
  const wantsLatest = typeof body.wantsLatest === 'boolean' ? body.wantsLatest : undefined;

  const takeNum =
    body.take !== undefined && body.take !== null && typeof body.take === 'number' && Number.isFinite(body.take)
      ? Math.min(TAKE_MAX, Math.max(TAKE_MIN, Math.floor(body.take)))
      : undefined;

  return {
    ok: true,
    params: {
      message,
      conversationId,
      ...(dateFrom !== undefined && { dateFrom }),
      ...(dateTo !== undefined && { dateTo }),
      ...(metrics !== undefined && { metrics }),
      ...(regulations !== undefined && { regulations }),
      ...(range !== undefined && { range }),
      ...(symbol !== undefined && { symbol }),
      ...(symbols !== undefined && { symbols }),
      ...(takeNum !== undefined && { take: takeNum }),
      ...(type !== undefined && { type }),
      ...(wantsLatest !== undefined && { wantsLatest })
    }
  };
}

/**
 * Call after normalizeAuthToken. Returns error if token is present and too long.
 */
export function validateTokenLength(token: string | undefined): { ok: true } | { ok: false; status: 400; error: string } {
  if (!token) return { ok: true };
  if (/[^\x21-\x7E]/.test(token)) {
    return {
      ok: false,
      status: 400,
      error: 'Token contains invalid characters.'
    };
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Token must be at most ${MAX_TOKEN_LENGTH} characters.`
    };
  }
  if (!JWT_PATTERN.test(token)) {
    return {
      ok: false,
      status: 400,
      error: 'Token must be a JWT (header.payload.signature).'
    };
  }
  return { ok: true };
}

export function validateImpersonationId(
  impersonationId: string | undefined
): { ok: true; value?: string } | { ok: false; status: 400; error: string } {
  if (!impersonationId) return { ok: true };
  const trimmed = impersonationId.trim();
  if (!trimmed) return { ok: true };
  if (trimmed.length > MAX_IMPERSONATION_ID_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `impersonation-id must be at most ${MAX_IMPERSONATION_ID_LENGTH} characters.`
    };
  }
  if (!IMPERSONATION_ID_PATTERN.test(trimmed)) {
    return {
      ok: false,
      status: 400,
      error: 'impersonation-id contains invalid characters.'
    };
  }
  return { ok: true, value: trimmed };
}

type ParseResult<T> =
  | { ok: true; params: T | undefined }
  | { ok: false; status: 400; error: string };

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isIsoDateLike(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export function parseCreateOrderParams(
  value: unknown
): ParseResult<import('./types').CreateOrderParams> {
  if (value === undefined || value === null) {
    return { ok: true, params: undefined };
  }
  if (!isRecord(value)) {
    return { ok: false, status: 400, error: 'createOrderParams must be an object.' };
  }
  const unknownKeys = Object.keys(value).filter((key) => !CREATE_ORDER_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `createOrderParams has unknown field(s): ${unknownKeys.join(', ')}.`
    };
  }

  const params: import('./types').CreateOrderParams = {};

  const symbol = safeString(value.symbol);
  if (symbol !== undefined) {
    if (!SYMBOL_PATTERN.test(symbol)) {
      return { ok: false, status: 400, error: 'createOrderParams.symbol is invalid.' };
    }
    params.symbol = symbol;
  }

  const type = safeString(value.type);
  if (type !== undefined) {
    if (!ORDER_TYPES.includes(type as (typeof ORDER_TYPES)[number])) {
      return { ok: false, status: 400, error: 'createOrderParams.type is invalid.' };
    }
    params.type = type as import('./types').OrderType;
  }

  const quantity = safePositiveNumber(value.quantity);
  if (value.quantity !== undefined && quantity === undefined) {
    return { ok: false, status: 400, error: 'createOrderParams.quantity must be > 0.' };
  }
  if (quantity !== undefined && quantity > MAX_QUANTITY) {
    return {
      ok: false,
      status: 400,
      error: `createOrderParams.quantity must be at most ${MAX_QUANTITY}.`
    };
  }
  if (quantity !== undefined) params.quantity = quantity;

  const unitPrice = safeNonNegativeNumber(value.unitPrice);
  if (value.unitPrice !== undefined && unitPrice === undefined) {
    return { ok: false, status: 400, error: 'createOrderParams.unitPrice must be >= 0.' };
  }
  if (unitPrice !== undefined && unitPrice > MAX_MONETARY_VALUE) {
    return {
      ok: false,
      status: 400,
      error: `createOrderParams.unitPrice must be at most ${MAX_MONETARY_VALUE}.`
    };
  }
  if (unitPrice !== undefined) params.unitPrice = unitPrice;

  const fee = safeNonNegativeNumber(value.fee);
  if (value.fee !== undefined && fee === undefined) {
    return { ok: false, status: 400, error: 'createOrderParams.fee must be >= 0.' };
  }
  if (fee !== undefined && fee > MAX_MONETARY_VALUE) {
    return {
      ok: false,
      status: 400,
      error: `createOrderParams.fee must be at most ${MAX_MONETARY_VALUE}.`
    };
  }
  if (fee !== undefined) params.fee = fee;

  const date = safeString(value.date);
  if (date !== undefined) {
    if (!isIsoDateLike(date)) {
      return { ok: false, status: 400, error: 'createOrderParams.date must be an ISO date string.' };
    }
    params.date = date;
  }

  const currency = safeString(value.currency);
  if (currency !== undefined) {
    if (!CURRENCY_PATTERN.test(currency)) {
      return { ok: false, status: 400, error: 'createOrderParams.currency is invalid.' };
    }
    params.currency = currency;
  }

  const accountId = safeString(value.accountId);
  if (accountId !== undefined) {
    if (accountId.length > MAX_STRING_FIELD_LENGTH * 2) {
      return { ok: false, status: 400, error: 'createOrderParams.accountId is too long.' };
    }
    params.accountId = accountId;
  }

  const dataSource = safeString(value.dataSource);
  if (dataSource !== undefined) {
    if (!DATA_SOURCE_PATTERN.test(dataSource.toUpperCase())) {
      return { ok: false, status: 400, error: 'createOrderParams.dataSource is invalid.' };
    }
    params.dataSource = dataSource;
  }

  const comment = safeString(value.comment);
  if (comment !== undefined) {
    if (comment.length > MAX_COMMENT_LENGTH) {
      return { ok: false, status: 400, error: 'createOrderParams.comment is too long.' };
    }
    params.comment = comment;
  }

  return {
    ok: true,
    params: Object.keys(params).length > 0 ? params : undefined
  };
}
