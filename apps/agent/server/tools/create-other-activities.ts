import type { CreateOrderDtoBody, GhostfolioClient } from '../ghostfolio-client';
import type { CreateOrderParams, OrderType } from '../types';
import { toToolErrorPayload } from './tool-error';

const ALLOWED_TYPES: readonly OrderType[] = ['DIVIDEND', 'FEE', 'INTEREST', 'LIABILITY'];

interface CreateOtherActivitiesToolInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
  createOrderParams?: CreateOrderParams;
}

function nowIso(): string {
  return new Date().toISOString();
}

function shiftDays(base: Date, deltaDays: number): string {
  const shifted = new Date(base);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted.toISOString();
}

function resolveDateInput(rawDate: unknown, message: string): string {
  const now = new Date();
  const messageNormalized = message.toLowerCase();
  const dateText = typeof rawDate === 'string' ? rawDate.trim() : '';
  const dateNormalized = dateText.toLowerCase();

  if (messageNormalized.includes('today') || dateNormalized.includes('today')) return now.toISOString();
  if (messageNormalized.includes('yesterday') || dateNormalized.includes('yesterday')) return shiftDays(now, -1);
  if (messageNormalized.includes('tomorrow') || dateNormalized.includes('tomorrow')) return shiftDays(now, 1);

  if (dateText) {
    const parsed = new Date(dateText);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return nowIso();
}

function safeNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return undefined;
}

function safeString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function parseUserBaseCurrency(user: unknown): string | undefined {
  if (!user || typeof user !== 'object') return undefined;
  const settingsWrapper = (user as { settings?: unknown }).settings;
  if (!settingsWrapper || typeof settingsWrapper !== 'object') return undefined;
  const settings = (settingsWrapper as { settings?: unknown }).settings;
  if (!settings || typeof settings !== 'object') return undefined;
  return safeString((settings as { baseCurrency?: unknown }).baseCurrency);
}

function parseUserAccounts(user: unknown): { id: string; name: string }[] {
  if (!user || typeof user !== 'object') return [];
  const accounts = (user as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((account) => {
      if (!account || typeof account !== 'object') return undefined;
      const id = safeString((account as { id?: unknown }).id);
      if (!id) return undefined;
      const name = safeString((account as { name?: unknown }).name) ?? 'Account';
      return { id, name };
    })
    .filter((account): account is { id: string; name: string } => Boolean(account));
}

function normalizeOtherActivityType(type: unknown): OrderType | undefined {
  if (typeof type !== 'string') return undefined;
  const normalized = type.trim().toUpperCase();
  if (normalized === 'DIVIDENT') {
    return 'DIVIDEND';
  }
  if (normalized === 'LIABILTY' || normalized === 'LIABLITY') {
    return 'LIABILITY';
  }
  return ALLOWED_TYPES.includes(normalized as OrderType) ? (normalized as OrderType) : undefined;
}

function resolveDefaultSymbolForType(type: OrderType): string | undefined {
  if (type === 'DIVIDEND') return 'DIVIDEND';
  if (type === 'LIABILITY') return 'LIABILITY';
  if (type === 'FEE') return 'FEE';
  if (type === 'INTEREST') return 'INTEREST';
  return undefined;
}

export async function createOtherActivitiesTool({
  client,
  impersonationId,
  message,
  token,
  createOrderParams: params
}: CreateOtherActivitiesToolInput): Promise<Record<string, unknown>> {
  const dataAsOf = new Date().toISOString();
  const sources = ['ghostfolio_api'];
  const type = normalizeOtherActivityType(params?.type);
  let symbol = safeString(params?.symbol);

  if (!type || !ALLOWED_TYPES.includes(type)) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['type'],
      answer:
        'Which activity would you like to record? Choose one: DIVIDEND, FEE, INTEREST, LIABILITY.',
      summary: 'Missing or unsupported non-trade activity type.',
      data_as_of: dataAsOf,
      sources
    };
  }

  if (!symbol) {
    symbol = type ? resolveDefaultSymbolForType(type) : undefined;
  }

  if (!symbol) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['symbol'],
      answer: 'Which symbol should this activity be recorded for? (e.g. AAPL, TSLA, BTC-USD)',
      summary: 'Missing symbol for non-trade activity.',
      data_as_of: dataAsOf,
      sources
    };
  }

  const amount = safeNumber(params?.unitPrice);
  if (amount === undefined || amount <= 0) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['unitPrice'],
      answer: `What amount should I record for this ${type.toLowerCase()} activity?`,
      summary: 'Missing amount (unitPrice) for non-trade activity.',
      data_as_of: dataAsOf,
      sources
    };
  }

  let currency = safeString(params?.currency);
  let accountId = safeString(params?.accountId);
  let user: unknown;

  if (!currency || !accountId) {
    try {
      user = await client.getUser({ impersonationId, token });
    } catch {
      // ignore; clarification below
    }
  }

  if (!currency) currency = parseUserBaseCurrency(user);
  if (!currency) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['currency'],
      answer: 'Which currency should we use? (e.g. USD, EUR)',
      summary: 'Currency required for non-trade activity.',
      data_as_of: dataAsOf,
      sources
    };
  }

  if (!accountId) {
    const accounts = parseUserAccounts(user);
    if (accounts.length === 1) {
      accountId = accounts[0].id;
    } else {
      const accountList =
        accounts.length > 0
          ? ` Available accounts: ${accounts.map((account) => `${account.name} (id: ${account.id})`).join(', ')}.`
          : '';
      return {
        success: true,
        needsClarification: true,
        missingFields: ['accountId'],
        answer: `Please choose an account id for this activity.${accountList}`,
        summary: 'Account id required for non-trade activity.',
        data_as_of: dataAsOf,
        sources
      };
    }
  }

  const dto: CreateOrderDtoBody = {
    type,
    symbol,
    currency,
    date: resolveDateInput(params?.date, message),
    quantity: safeNumber(params?.quantity) ?? 1,
    unitPrice: amount,
    fee: safeNumber(params?.fee) ?? 0,
    updateAccountBalance: true,
    dataSource: safeString(params?.dataSource) ?? 'MANUAL'
  };
  if (accountId) dto.accountId = accountId;
  if (params?.comment !== undefined) dto.comment = params.comment?.trim() ?? undefined;

  try {
    const created = await client.createOrder(dto, { impersonationId, token });
    const orderId = safeString((created as { id?: unknown }).id);
    if (!orderId) {
      return {
        success: false,
        answer: 'Ghostfolio API did not return a valid activity id.',
        summary: 'Create non-trade activity failed: missing id.',
        error: {
          error_code: 'GHOSTFOLIO_INVALID_RESPONSE',
          message: 'Missing activity id in Ghostfolio createOrder response',
          retryable: false
        },
        data_as_of: dataAsOf,
        sources
      };
    }

    await client.getOrderById(orderId, { impersonationId, token });
    return {
      success: true,
      orderId,
      answer: `Recorded: ${type} ${symbol} ${currency} ${amount}.`,
      summary: `Created ${type} activity for ${symbol}.`,
      data_as_of: dataAsOf,
      sources
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not create activity: ${toolError.message}.`,
      summary: `Create non-trade activity failed: ${toolError.message}`,
      error: toolError,
      data_as_of: dataAsOf,
      sources
    };
  }
}
