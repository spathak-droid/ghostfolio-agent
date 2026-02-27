import {
  CREATE_ORDER_ALLOWED_KEYS,
  CURRENCY_PATTERN,
  DATA_SOURCE_PATTERN,
  isIsoDateLike,
  isRecord,
  MAX_COMMENT_LENGTH,
  MAX_MONETARY_VALUE,
  MAX_QUANTITY,
  MAX_STRING_FIELD_LENGTH,
  ORDER_TYPES,
  safeNonNegativeNumber,
  safePositiveNumber,
  safeString,
  SYMBOL_PATTERN
} from './common';

type ParseResult<T> =
  | { ok: true; params: T | undefined }
  | { ok: false; status: 400; error: string };

export function parseCreateOrderParams(
  value: unknown
): ParseResult<import('../types').CreateOrderParams> {
  if (value === undefined || value === null) {
    return { ok: true, params: undefined };
  }

  if (!isRecord(value)) {
    return { ok: false, status: 400, error: 'createOrderParams must be an object.' };
  }

  const unknownKeys = Object.keys(value).filter(
    (key) => !CREATE_ORDER_ALLOWED_KEYS.has(key)
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `createOrderParams has unknown field(s): ${unknownKeys.join(', ')}.`
    };
  }

  const params: import('../types').CreateOrderParams = {};

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
    params.type = type as import('../types').OrderType;
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
      return {
        ok: false,
        status: 400,
        error: 'createOrderParams.date must be an ISO date string.'
      };
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
