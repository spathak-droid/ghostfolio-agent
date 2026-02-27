/**
 * Create order tool: record a buy/sell/dividend/activity via POST /api/v1/order.
 * Asks for required fields (e.g. quantity) when missing; fetches unit price from market data.
 * Always sets updateAccountBalance: true.
 */

import type { CreateOrderParams, OrderType } from '../types';
import type { GhostfolioClient } from '../clients';
import type { CreateOrderDtoBody } from '../clients';
import { isUsdTransactionCapExceeded, MAX_USD_TRANSACTION_AMOUNT } from './order-limits';
import { resolveSymbolWithCandidates } from './symbol-resolver';
import { toToolErrorPayload } from './tool-error';

const BUY_SELL_TYPES: readonly OrderType[] = ['BUY', 'SELL'];

/** Alternative data sources to try for price when primary fails (e.g. crypto: YAHOO may fail, COINGECKO often works). */
const FALLBACK_DATA_SOURCES = ['COINGECKO', 'YAHOO'];

/** COINGECKO uses lowercase ids for crypto; map common tickers to CoinGecko id when primary symbol fails. */
const COINGECKO_SYMBOL_IDS: Readonly<Record<string, string>> = {
  'BTC-USD': 'bitcoin',
  BTCUSD: 'bitcoin',
  'ETH-USD': 'ethereum',
  ETHUSD: 'ethereum',
  'SOL-USD': 'solana'
};
const CANONICAL_CRYPTO_BY_INPUT: Readonly<Record<string, string>> = {
  bitcoin: 'bitcoin',
  btc: 'bitcoin',
  'btc-usd': 'bitcoin',
  btcusd: 'bitcoin',
  ethereum: 'ethereum',
  eth: 'ethereum',
  'eth-usd': 'ethereum',
  ethusd: 'ethereum',
  solana: 'solana',
  sol: 'solana',
  'sol-usd': 'solana',
  solusd: 'solana'
};

export interface CreateOrderToolInput {
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

function normalizeSymbolInput(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function resolveCanonicalCoinGeckoSymbol(params: {
  symbolInput: string;
  primarySymbol: string;
}): string | undefined {
  const byInput = CANONICAL_CRYPTO_BY_INPUT[normalizeSymbolInput(params.symbolInput)];
  if (byInput) return byInput;
  return COINGECKO_SYMBOL_IDS[params.primarySymbol];
}

function parseUserBaseCurrency(user: unknown): string | undefined {
  if (typeof user !== 'object' || user === null) return undefined;
  const settingsWrapper = (user as { settings?: unknown }).settings;
  if (typeof settingsWrapper !== 'object' || settingsWrapper === null) return undefined;
  const settings = (settingsWrapper as { settings?: unknown }).settings;
  if (typeof settings !== 'object' || settings === null) return undefined;
  return safeString((settings as { baseCurrency?: unknown }).baseCurrency);
}

function parseUserAccounts(user: unknown): { id: string; name: string }[] {
  if (typeof user !== 'object' || user === null) return [];
  const accounts = (user as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((account) => {
      if (typeof account !== 'object' || account === null) return undefined;
      const id = safeString((account as { id?: unknown }).id);
      if (!id) return undefined;
      const name = safeString((account as { name?: unknown }).name) ?? 'Account';
      return { id, name };
    })
    .filter((account): account is { id: string; name: string } => Boolean(account));
}

function resolveAccountReferenceToId(params: {
  accountReference?: string;
  accounts: { id: string; name: string }[];
}): string | undefined {
  const ref = params.accountReference?.trim();
  if (!ref) return undefined;

  const directIdMatch = params.accounts.find((account) => account.id === ref);
  if (directIdMatch) return directIdMatch.id;

  const normalizedRef = ref.toLowerCase();
  const directNameMatch = params.accounts.find((account) => account.name.toLowerCase() === normalizedRef);
  if (directNameMatch) return directNameMatch.id;

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseAccountCashBalance(
  portfolioSummary: unknown,
  accountId: string
): { balance: number; currency?: string } | undefined {
  if (!isRecord(portfolioSummary)) return undefined;
  const accounts = portfolioSummary.accounts;
  if (!isRecord(accounts)) return undefined;
  const account = accounts[accountId];
  if (!isRecord(account)) return undefined;

  const balance = finiteNumber(account.balance);
  if (balance === undefined) return undefined;

  const currency = safeString(account.currency);
  return { balance, currency };
}

function currenciesComparable(orderCurrency: string, accountCurrency?: string): boolean {
  if (!accountCurrency) return true;
  return orderCurrency.toUpperCase() === accountCurrency.toUpperCase();
}

function parseHoldingQuantity(holding: unknown): number | undefined {
  if (!isRecord(holding)) return undefined;
  const candidates = ['quantity', 'quantityInShares', 'shares', 'units'] as const;
  for (const key of candidates) {
    const value = finiteNumber(holding[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseHoldingQuantityBySymbol(
  portfolioSummary: unknown,
  symbol: string
): number | undefined {
  if (!isRecord(portfolioSummary)) return undefined;
  const holdings = portfolioSummary.holdings;
  if (!isRecord(holdings)) return undefined;

  const direct = holdings[symbol];
  const directQty = parseHoldingQuantity(direct);
  if (directQty !== undefined) return directQty;

  const normalizedSymbol = symbol.replace(/[-._/]/g, '').toUpperCase();
  for (const [key, value] of Object.entries(holdings)) {
    const normalizedKey = key.replace(/[-._/]/g, '').toUpperCase();
    if (normalizedKey !== normalizedSymbol) continue;
    const qty = parseHoldingQuantity(value);
    if (qty !== undefined) return qty;
  }

  return undefined;
}

/** Try to get market price and currency for a (dataSource, symbol). Returns undefined on failure or no price. */
async function fetchPriceForSymbol(
  client: GhostfolioClient,
  dataSource: string,
  symbol: string,
  opts: { impersonationId?: string; token?: string }
): Promise<{ price: number; currency: string } | undefined> {
  try {
    const data = await client.getSymbolData({
      dataSource,
      symbol,
      includeHistoricalData: 0,
      impersonationId: opts.impersonationId,
      token: opts.token
    });
    const d = data as { marketPrice?: number; currency?: string };
    const price = typeof d.marketPrice === 'number' && Number.isFinite(d.marketPrice) ? d.marketPrice : 0;
    const currency = typeof d.currency === 'string' ? d.currency : 'USD';
    if (price > 0) return { price, currency };
  } catch {
    // ignore
  }
  return undefined;
}

/** Try primary (dataSource, symbol), then other lookup results (e.g. COINGECKO when YAHOO fails). */
async function fetchUnitPriceWithFallback(
  client: GhostfolioClient,
  primary: { dataSource: string; symbol: string },
  lookupItems: { dataSource: string; symbol: string }[],
  symbolInput: string,
  opts: { impersonationId?: string; token?: string }
): Promise<{ price: number; currency: string } | undefined> {
  let result = await fetchPriceForSymbol(client, primary.dataSource, primary.symbol, opts);
  if (result) return result;

  const canonicalCoinGeckoSymbol = resolveCanonicalCoinGeckoSymbol({
    primarySymbol: primary.symbol,
    symbolInput
  });
  if (canonicalCoinGeckoSymbol) {
    result = await fetchPriceForSymbol(client, 'COINGECKO', canonicalCoinGeckoSymbol, opts);
    if (result) return result;
  }

  for (const fallbackSource of FALLBACK_DATA_SOURCES) {
    if (fallbackSource === primary.dataSource) continue;
    const symbolToTry =
      fallbackSource === 'COINGECKO' && COINGECKO_SYMBOL_IDS[primary.symbol]
        ? COINGECKO_SYMBOL_IDS[primary.symbol]
        : primary.symbol;
    result = await fetchPriceForSymbol(client, fallbackSource, symbolToTry, opts);
    if (result) return result;
  }

  for (const item of lookupItems) {
    if (item.dataSource === primary.dataSource && item.symbol === primary.symbol) continue;
    result = await fetchPriceForSymbol(client, item.dataSource, item.symbol, opts);
    if (result) return result;
  }

  return undefined;
}

export async function createOrderTool({
  client,
  impersonationId,
  message,
  token,
  createOrderParams: params
}: CreateOrderToolInput): Promise<Record<string, unknown>> {
  const dataAsOf = new Date().toISOString();
  const sources = ['ghostfolio_api'];

  if (!params?.symbol?.trim() || !params?.type) {
    const missingSymbol = !params?.symbol?.trim();
    const missingType = !params?.type;
    const missingFields = [missingSymbol ? 'symbol' : null, missingType ? 'type' : null].filter(
      Boolean
    ) as string[];
    const answer =
      missingSymbol && missingType
        ? 'What would you like to buy or sell? Please specify the symbol (e.g. AAPL, Apple) and whether it is a buy or sell.'
        : missingSymbol
          ? 'Which symbol would you like to trade? (e.g. AAPL, TSLA, SOL-USD)'
          : 'Is this a buy or a sell order?';
    const summary =
      missingSymbol && missingType
        ? 'Missing symbol and type; please specify what to buy or sell.'
        : missingSymbol
          ? 'Missing symbol for order.'
          : 'Missing order type (buy/sell).';
    return {
      success: true,
      needsClarification: true,
      missingFields,
      answer,
      summary,
      data_as_of: dataAsOf,
      sources
    };
  }

  const symbolInput = params.symbol.trim();
  const type = params.type as OrderType;
  const selectedDataSource = safeString(params.dataSource);

  const lookup = async (query: string) => {
    try {
      const res = await client.getSymbolLookup({ query, impersonationId, token });
      const items = (res as { items?: { dataSource: string; symbol: string }[] })?.items ?? [];
      return items;
    } catch {
      return [];
    }
  };

  const symbolResolution = selectedDataSource
    ? {
        resolved: {
          dataSource: selectedDataSource.toUpperCase(),
          symbol: symbolInput
        }
      }
    : await resolveSymbolWithCandidates(symbolInput, lookup);
  if (!symbolResolution.resolved) {
    if (Array.isArray(symbolResolution.candidates) && symbolResolution.candidates.length > 0) {
      const topCandidates = symbolResolution.candidates.slice(0, 3).map((candidate) => ({
        dataSource: candidate.dataSource,
        label: candidate.name
          ? `${candidate.name} (${candidate.symbol})`
          : candidate.symbol,
        symbol: candidate.symbol
      }));
      return {
        success: true,
        needsClarification: true,
        missingFields: ['symbol'],
        symbolOptions: topCandidates,
        answer:
          `I found multiple symbols for "${symbolInput}". Please choose one option below to continue your ${type.toLowerCase()} order.`,
        summary: `Multiple symbol matches found for ${symbolInput}`,
        data_as_of: dataAsOf,
        sources
      };
    }
    return {
      success: true,
      needsClarification: true,
      missingFields: ['symbol'],
      answer: `Could not find a symbol for "${symbolInput}". Please use a ticker (e.g. AAPL) or a name we can resolve.`,
      summary: `Symbol not found: ${symbolInput}`,
      data_as_of: dataAsOf,
      sources
    };
  }

  const { dataSource, symbol } = symbolResolution.resolved;
  const lookupItems = selectedDataSource ? [] : await lookup(symbolInput);

  const needsQuantity = BUY_SELL_TYPES.includes(type);
  const quantity = needsQuantity ? safeNumber(params.quantity) : undefined;
  const unitPrice = safeNumber(params.unitPrice);

  if (needsQuantity && quantity === undefined) {
    const priceResult = await fetchUnitPriceWithFallback(
      client,
      { dataSource, symbol },
      lookupItems,
      symbolInput,
      { impersonationId, token }
    );
    const price = priceResult?.price ?? 0;
    const currency = priceResult?.currency ?? 'USD';
    const priceStr = price > 0 ? ` Current price is about ${currency} ${price}.` : '';
    return {
      success: true,
      needsClarification: true,
      missingFields: ['quantity'],
      answer: `How many shares of ${symbol} do you want to ${type.toLowerCase()}?${priceStr}`,
      summary: `Quantity required for ${type}; current price ~${currency} ${price}`,
      data_as_of: dataAsOf,
      sources
    };
  }

  let unitPriceToUse = unitPrice;
  let marketCurrency: string | undefined;
  if (unitPriceToUse === undefined && (needsQuantity ? quantity! > 0 : true)) {
    const priceResult = await fetchUnitPriceWithFallback(
      client,
      { dataSource, symbol },
      lookupItems,
      symbolInput,
      { impersonationId, token }
    );
    unitPriceToUse = priceResult?.price;
    marketCurrency = safeString(priceResult?.currency);
  }

  if (needsQuantity && (unitPriceToUse === undefined || unitPriceToUse < 0)) {
    return {
      success: false,
      answer:
        'Could not fetch current price for this symbol. Please try again later or specify the unit price.',
      summary: 'Market data unavailable for unit price',
      data_as_of: dataAsOf,
      sources
    };
  }

  let currency = safeString(params.currency) ?? marketCurrency;
  const accountReference = safeString(params.accountId);
  let accountId = accountReference;
  let user: unknown;
  let accounts: { id: string; name: string }[] = [];

  if (!currency || !accountReference) {
    try {
      user = await client.getUser({ impersonationId, token });
      accounts = parseUserAccounts(user);
    } catch {
      // ignore
    }
  } else {
    try {
      user = await client.getUser({ impersonationId, token });
      accounts = parseUserAccounts(user);
    } catch {
      // ignore
    }
  }

  if (!currency) currency = parseUserBaseCurrency(user);
  if (!currency) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['currency'],
      answer: 'Which currency should we use for this order? (e.g. USD, EUR)',
      summary: 'Currency required',
      data_as_of: dataAsOf,
      sources
    };
  }

  const resolvedAccountId = resolveAccountReferenceToId({
    accountReference,
    accounts
  });
  if (accountReference && resolvedAccountId) {
    accountId = resolvedAccountId;
  }

  if (!accountId) {
    if (accounts.length === 1) {
      accountId = accounts[0].id;
    } else {
      const accountList =
        accounts.length > 0
          ? ` I found ${accounts.length} accounts: ${accounts.map((account) => account.name).join(', ')}. Which one do you want?`
          : '';
      return {
        success: true,
        needsClarification: true,
        missingFields: ['accountId'],
        answer: `Please choose an account for this order (required when updating cash balance).${accountList}`,
        summary: 'Account required to update cash balance.',
        data_as_of: dataAsOf,
        sources
      };
    }
  }

  const date = resolveDateInput(params.date, message);
  const fee = safeNumber(params.fee) ?? 0;
  const qty = needsQuantity ? quantity! : (safeNumber(params.quantity) ?? 0);
  const price = unitPriceToUse ?? 0;
  const estimatedCost = qty * price + fee;

  let portfolioSummary: unknown;
  try {
    portfolioSummary = await client.getPortfolioSummary({ impersonationId, token });
  } catch {
    return {
      success: false,
      answer:
        type === 'SELL'
          ? `Could not verify holdings for ${symbol} because Ghostfolio API failed.`
          : 'Could not verify available cash for the selected account because Ghostfolio API failed.',
      summary:
        type === 'SELL'
          ? 'Ghostfolio API failure while verifying holdings for SELL order'
          : 'Ghostfolio API failure while verifying account cash balance for BUY order',
      data_as_of: dataAsOf,
      sources
    };
  }

  if (isUsdTransactionCapExceeded({ amount: estimatedCost, currency })) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['quantity'],
      answer:
        `Transaction amount exceeds hard limit of USD ${MAX_USD_TRANSACTION_AMOUNT}. ` +
        `Estimated cost is USD ${estimatedCost.toFixed(2)}. Please provide a lower quantity or unit price.`,
      summary: 'Transaction amount exceeds hard limit',
      data_as_of: dataAsOf,
      sources
    };
  }

  if (type === 'BUY' && accountId) {
    const accountBalance = parseAccountCashBalance(portfolioSummary, accountId);
    if (!accountBalance) {
      return {
        success: true,
        needsClarification: true,
        missingFields: ['accountId'],
        answer:
          'I could not verify available cash for the selected account. ' +
          'Please choose another account or try again in a moment.',
        summary: 'Unable to verify account cash balance for BUY order',
        data_as_of: dataAsOf,
        sources
      };
    }

    if (
      currenciesComparable(currency, accountBalance.currency) &&
      estimatedCost > accountBalance.balance
    ) {
      return {
        success: true,
        needsClarification: true,
        missingFields: ['quantity'],
        answer:
          `Estimated cost ${currency} ${estimatedCost.toFixed(2)} exceeds available cash ` +
          `${currency} ${accountBalance.balance.toFixed(2)} in the selected account. ` +
          'Please provide a lower quantity, a lower unit price, or fund the account first.',
        summary: 'Insufficient account balance for BUY order',
        data_as_of: dataAsOf,
        sources
      };
    }
  }

  if (type === 'SELL') {
    const heldQuantity = parseHoldingQuantityBySymbol(portfolioSummary, symbol);
    if (heldQuantity === undefined) {
      return {
        success: true,
        needsClarification: true,
        missingFields: ['quantity'],
        answer:
          `I could not verify your current ${symbol} holdings to validate this SELL order. ` +
          'Please try again in a moment or confirm the quantity you currently hold.',
        summary: 'Unable to verify holdings for SELL order',
        data_as_of: dataAsOf,
        sources
      };
    }

    if (qty > heldQuantity) {
      return {
        success: true,
        needsClarification: true,
        missingFields: ['quantity'],
        answer:
          `Requested SELL quantity ${qty} exceeds your current holdings of ${heldQuantity} ${symbol}. ` +
          'Please provide a lower quantity.',
        summary: 'Insufficient holdings for SELL order',
        data_as_of: dataAsOf,
        sources
      };
    }
  }

  const dto: CreateOrderDtoBody = {
    type,
    symbol,
    currency,
    date,
    quantity: qty,
    unitPrice: price,
    fee,
    updateAccountBalance: true,
    dataSource
  };
  if (accountId) dto.accountId = accountId;
  if (params.comment !== undefined) dto.comment = params.comment?.trim() ?? undefined;

  try {
    const order = await client.createOrder(dto, { impersonationId, token });
    const orderId = order?.id;
    if (typeof orderId !== 'string' || !orderId.trim()) {
      return {
        success: false,
        answer: 'Ghostfolio API did not return a valid order id. Order status is unknown; nothing was confirmed.',
        summary: 'Create order failed: missing order id in API response',
        error: {
          error_code: 'GHOSTFOLIO_INVALID_RESPONSE',
          message: 'Missing order id in Ghostfolio createOrder response',
          retryable: false
        },
        data_as_of: dataAsOf,
        sources
      };
    }

    try {
      await client.getOrderById(orderId, { impersonationId, token });
    } catch (verificationError) {
      const verificationMessage =
        verificationError instanceof Error ? verificationError.message : String(verificationError);
      return {
        success: false,
        answer:
          `Order request was sent but the created activity could not be verified (id: ${orderId}). ` +
          `Error: ${verificationMessage}.`,
        summary: `Create order failed post-check: ${verificationMessage}`,
        error: toToolErrorPayload(verificationError),
        data_as_of: dataAsOf,
        sources
      };
    }

    return {
      success: true,
      orderId,
      answer: `Recorded: ${type} ${qty} ${symbol} at ${currency} ${price}${fee > 0 ? ` (fee ${currency} ${fee})` : ''}.`,
      summary: `Created ${type} order for ${symbol}`,
      data_as_of: dataAsOf,
      sources
    };
  } catch (err) {
    const toolError = toToolErrorPayload(err);
    return {
      success: false,
      answer: `Could not create order: ${toolError.message}. Please check the data and try again.`,
      summary: `Create order failed: ${toolError.message}`,
      error: toolError,
      data_as_of: dataAsOf,
      sources
    };
  }
}
