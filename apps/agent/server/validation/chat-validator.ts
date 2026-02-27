import {
  CHAT_BODY_ALLOWED_KEYS,
  CLEAR_CHAT_BODY_ALLOWED_KEYS,
  hasControlCharacters,
  isRecord,
  MAX_ARRAY_LENGTH,
  MAX_CONVERSATION_ID_LENGTH,
  MAX_STRING_FIELD_LENGTH,
  METRIC_VALUES,
  optionalDate,
  ORDER_TYPES,
  RANGE_VALUES,
  SYMBOL_PATTERN,
  TAKE_MAX,
  TAKE_MIN,
  trimString
} from './common';

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

export type ValidateClearChatBodyResult =
  | { ok: true; params: { conversationId: string } }
  | { ok: false; status: 400; error: string };

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
  if (message.length > 32_000) {
    return {
      ok: false,
      status: 400,
      error: 'message must be at most 32000 characters.'
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
  if (
    body.dateFrom !== undefined &&
    body.dateFrom !== null &&
    dateFrom === undefined &&
    typeof body.dateFrom === 'string' &&
    body.dateFrom.trim().length > 0
  ) {
    return { ok: false, status: 400, error: 'dateFrom must be YYYY-MM-DD.' };
  }

  const dateTo = optionalDate(body.dateTo);
  if (
    body.dateTo !== undefined &&
    body.dateTo !== null &&
    dateTo === undefined &&
    typeof body.dateTo === 'string' &&
    body.dateTo.trim().length > 0
  ) {
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
      return {
        ok: false,
        status: 400,
        error: `symbols must have at most ${MAX_ARRAY_LENGTH} items.`
      };
    }
    const trimmed = body.symbols.map((s) => s.trim()).filter((s) => s.length > 0);
    if (trimmed.some((s) => s.length > MAX_STRING_FIELD_LENGTH || !SYMBOL_PATTERN.test(s))) {
      return {
        ok: false,
        status: 400,
        error: `Each symbol must match ${SYMBOL_PATTERN.toString()}.`
      };
    }
    symbols = trimmed.length > 0 ? trimmed : undefined;
  }

  let metrics: string[] | undefined;
  if (Array.isArray(body.metrics)) {
    if (!body.metrics.every((item: unknown) => typeof item === 'string')) {
      return { ok: false, status: 400, error: 'metrics must contain only strings.' };
    }
    if (body.metrics.length > MAX_ARRAY_LENGTH) {
      return {
        ok: false,
        status: 400,
        error: `metrics must have at most ${MAX_ARRAY_LENGTH} items.`
      };
    }
    const trimmed = body.metrics.map((s) => s.trim()).filter((s) => s.length > 0);
    if (trimmed.some((s) => s.length > MAX_STRING_FIELD_LENGTH)) {
      return {
        ok: false,
        status: 400,
        error: `Each metric must be at most ${MAX_STRING_FIELD_LENGTH} characters.`
      };
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
  if (
    symbol !== undefined &&
    (symbol.length > MAX_STRING_FIELD_LENGTH || !SYMBOL_PATTERN.test(symbol))
  ) {
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
    body.take !== undefined &&
    body.take !== null &&
    typeof body.take === 'number' &&
    Number.isFinite(body.take)
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

export function validateClearChatBody(body: unknown): ValidateClearChatBodyResult {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }

  const unknownKeys = Object.keys(body).filter(
    (key) => !CLEAR_CHAT_BODY_ALLOWED_KEYS.has(key)
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Unknown request field(s): ${unknownKeys.join(', ')}.`
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

  return { ok: true, params: { conversationId } };
}
