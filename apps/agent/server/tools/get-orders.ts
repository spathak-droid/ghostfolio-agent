/**
 * Get orders tool: list activities (orders) from GET /api/v1/order, optionally filtered by symbol/name.
 * Use when the user wants to update an order but has not given an order id—e.g. they say "apple" or "doge"
 * so we can show matching orders and ask which one to update and what to change.
 *
 * Inputs: client, message (filter text, e.g. "apple", "doge"), token, impersonationId.
 * Outputs: orders (array with id, symbol, type, date, quantity, unitPrice), answer, summary.
 * Failure modes: API error → error payload; no match → success with empty orders and "I didn't find that" answer.
 */

import type { GhostfolioClient } from '../clients';
import { toToolErrorPayload } from './tool-error';

export interface GetOrdersToolInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
}

interface ActivityRow {
  id: string;
  symbol: string;
  type: string;
  date: string;
  quantity: number;
  unitPrice: number;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function matchesFilter(activity: Record<string, unknown>, filter: string): boolean {
  if (!filter) return true;
  const lower = filter.toLowerCase();
  const symbolProfile = activity.SymbolProfile as Record<string, unknown> | undefined;
  const symbol = asString(symbolProfile?.symbol) ?? '';
  const name = asString(symbolProfile?.name) ?? '';
  return (
    symbol.toLowerCase().includes(lower) ||
    name.toLowerCase().includes(lower)
  );
}

function toOrderRow(activity: Record<string, unknown>): ActivityRow | undefined {
  const id = asString(activity.id);
  const symbolProfile = activity.SymbolProfile as Record<string, unknown> | undefined;
  const symbol = asString(symbolProfile?.symbol) ?? '';
  const type = asString(activity.type) ?? '';
  const date = asString(activity.date);
  const quantity = asNumber(activity.quantity);
  const unitPrice = asNumber(activity.unitPrice);
  if (!id || !date) return undefined;
  return {
    id,
    symbol: symbol || '—',
    type: type || '—',
    date: date.slice(0, 10),
    quantity: quantity ?? 0,
    unitPrice: unitPrice ?? 0
  };
}

export async function getOrdersTool({
  client,
  impersonationId,
  message,
  token
}: GetOrdersToolInput): Promise<Record<string, unknown>> {
  const dataAsOf = new Date().toISOString();
  const sources = ['ghostfolio_api'];
  const filter = (message ?? '').trim();

  try {
    const data = await client.getTransactions({ impersonationId, token, range: 'max', take: 200 });
    const activities: Record<string, unknown>[] =
      Boolean(data) && typeof data === 'object' && Array.isArray((data as { activities?: unknown }).activities)
        ? ((data as { activities: Record<string, unknown>[] }).activities as Record<string, unknown>[])
        : [];

    const filtered = filter ? activities.filter((a) => matchesFilter(a, filter)) : activities;
    const orders = filtered.map(toOrderRow).filter((row): row is ActivityRow => row !== undefined);

    if (orders.length === 0) {
      const answer = filter
        ? `I didn't find any orders for "${filter}". Try another symbol or name, or check your activities list.`
        : 'You have no orders in your activities list.';
      return {
        success: true,
        orders: [],
        count: 0,
        answer,
        summary: filter ? `No orders found for "${filter}"` : 'No orders found',
        data_as_of: dataAsOf,
        sources
      };
    }

    const answer =
      orders.length === 1
        ? `I found 1 order: ${orders[0].type} ${orders[0].symbol} on ${orders[0].date} (id: ${orders[0].id}). What do you want to update? You can say the order id or describe the change (e.g. quantity, date).`
        : `I found ${orders.length} orders: ${orders
            .map(
              (o, i) =>
                `${i + 1}) ${o.type} ${o.symbol} on ${o.date} — id: ${o.id}`
            )
            .join('; ')}. Which do you want to update? Say the order id or "the first one", then what you want to change.`;

    return {
      success: true,
      orders,
      count: orders.length,
      answer,
      summary: `Found ${orders.length} order(s)${filter ? ` for "${filter}"` : ''}`,
      data_as_of: dataAsOf,
      sources
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      orders: [],
      count: 0,
      answer: `Could not fetch orders: ${toolError.message}. Please try again.`,
      summary: `Get orders failed: ${toolError.message}`,
      error: toolError,
      data_as_of: dataAsOf,
      sources
    };
  }
}
