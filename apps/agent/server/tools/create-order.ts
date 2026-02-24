/**
 * Create order tool: record a buy/sell/dividend/activity via POST /api/v1/order.
 * Asks for required fields (e.g. quantity) when missing; fetches unit price from market data.
 * Always sets updateAccountBalance: true.
 */

import type { CreateOrderParams, OrderType } from '../types';
import type { GhostfolioClient } from '../ghostfolio-client';
import type { CreateOrderDtoBody } from '../ghostfolio-client';
import { resolveSymbol } from './symbol-resolver';

const BUY_SELL_TYPES: readonly OrderType[] = ['BUY', 'SELL'];

/** Alternative data sources to try for price when primary fails (e.g. crypto: YAHOO may fail, COINGECKO often works). */
const FALLBACK_DATA_SOURCES = ['COINGECKO', 'YAHOO'];

/** COINGECKO uses lowercase ids for crypto; map common tickers to CoinGecko id when primary symbol fails. */
const COINGECKO_SYMBOL_IDS: Readonly<Record<string, string>> = {
  'BTC-USD': 'bitcoin',
  'ETH-USD': 'ethereum',
  'SOL-USD': 'solana'
};

export interface CreateOrderToolInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
  createOrderParams?: CreateOrderParams;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

function safeNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
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
  opts: { impersonationId?: string; token?: string }
): Promise<{ price: number; currency: string } | undefined> {
  let result = await fetchPriceForSymbol(client, primary.dataSource, primary.symbol, opts);
  if (result) return result;

  for (const item of lookupItems) {
    if (item.dataSource === primary.dataSource && item.symbol === primary.symbol) continue;
    result = await fetchPriceForSymbol(client, item.dataSource, item.symbol, opts);
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

  return undefined;
}

export async function createOrderTool({
  client,
  impersonationId,
  message: _message,
  token,
  createOrderParams: params
}: CreateOrderToolInput): Promise<Record<string, unknown>> {
  const dataAsOf = new Date().toISOString();
  const sources = ['ghostfolio_api'];

  if (!params || !params.symbol?.trim() || !params.type) {
    return {
      success: true,
      needsClarification: true,
      missingFields: [!params?.symbol?.trim() ? 'symbol' : null, !params?.type ? 'type' : null].filter(
        Boolean
      ) as string[],
      answer:
        'What would you like to buy or sell? Please specify the symbol (e.g. AAPL, Apple) and whether it is a buy or sell.',
      summary: 'Missing symbol or type; please specify what to buy or sell.',
      data_as_of: dataAsOf,
      sources
    };
  }

  const symbolInput = params.symbol.trim();
  const type = params.type as OrderType;

  const lookup = async (query: string) => {
    try {
      const res = await client.getSymbolLookup({ query, impersonationId, token });
      const items = (res as { items?: { dataSource: string; symbol: string }[] })?.items ?? [];
      return items;
    } catch {
      return [];
    }
  };

  const resolved = await resolveSymbol(symbolInput, lookup);
  if (!resolved) {
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

  const { dataSource, symbol } = resolved;
  const lookupItems = await lookup(symbolInput);

  const needsQuantity = BUY_SELL_TYPES.includes(type);
  const quantity = needsQuantity ? safeNumber(params.quantity) : undefined;
  const unitPrice = safeNumber(params.unitPrice);

  if (needsQuantity && quantity === undefined) {
    const priceResult = await fetchUnitPriceWithFallback(
      client,
      { dataSource, symbol },
      lookupItems,
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
  if (unitPriceToUse === undefined && (needsQuantity ? quantity! > 0 : true)) {
    const priceResult = await fetchUnitPriceWithFallback(
      client,
      { dataSource, symbol },
      lookupItems,
      { impersonationId, token }
    );
    unitPriceToUse = priceResult?.price;
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

  let currency = typeof params.currency === 'string' && params.currency.trim() ? params.currency.trim() : undefined;
  if (!currency) {
    try {
      const user = await client.getUser({ impersonationId, token });
      const settings = (user as { settings?: { settings?: { baseCurrency?: string } } })?.settings?.settings;
      currency = typeof settings?.baseCurrency === 'string' ? settings.baseCurrency : undefined;
    } catch {
      // ignore
    }
  }
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

  const date = typeof params.date === 'string' && params.date.trim() ? params.date.trim() : todayIso();
  const fee = safeNumber(params.fee) ?? 0;
  const qty = needsQuantity ? quantity! : (safeNumber(params.quantity) ?? 0);
  const price = unitPriceToUse ?? 0;

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
  if (params.accountId?.trim()) dto.accountId = params.accountId.trim();
  if (params.comment !== undefined) dto.comment = params.comment?.trim() ?? undefined;

  try {
    const order = await client.createOrder(dto, { impersonationId, token });
    const orderId = order?.id;
    return {
      success: true,
      orderId,
      answer: `Recorded: ${type} ${qty} ${symbol} at ${currency} ${price}${fee > 0 ? ` (fee ${currency} ${fee})` : ''}.`,
      summary: `Created ${type} order for ${symbol}`,
      data_as_of: dataAsOf,
      sources
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      answer: `Could not create order: ${message}. Please check the data and try again.`,
      summary: `Create order failed: ${message}`,
      data_as_of: dataAsOf,
      sources
    };
  }
}
