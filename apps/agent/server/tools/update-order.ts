/**
 * Update order tool: edit an existing activity via PUT /api/v1/order/:id.
 * Always sets updateAccountBalance: true.
 */

import type { UpdateOrderParams } from '../types';
import type { GhostfolioClient } from '../ghostfolio-client';
import type { UpdateOrderDtoBody } from '../ghostfolio-client';

export interface UpdateOrderToolInput {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
  updateOrderParams?: UpdateOrderParams;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

export async function updateOrderTool({
  client,
  impersonationId,
  message: _message,
  token,
  updateOrderParams: params
}: UpdateOrderToolInput): Promise<Record<string, unknown>> {
  const dataAsOf = new Date().toISOString();
  const sources = ['ghostfolio_api'];

  if (!params?.orderId?.trim()) {
    return {
      success: true,
      needsClarification: true,
      missingFields: ['orderId'],
      answer:
        'Which order or activity do you want to update? Please provide the order/activity id (you can find it in your activities list).',
      summary: 'Order id required to update an activity.',
      data_as_of: dataAsOf,
      sources
    };
  }

  const orderId = params.orderId.trim();

  let existing: Record<string, unknown> | undefined;
  try {
    const res = await client.getOrderById(orderId, { impersonationId, token });
    existing = typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : undefined;
  } catch {
    return {
      success: false,
      answer: `Could not load order ${orderId}. It may not exist or you may not have access.`,
      summary: 'Failed to load order',
      data_as_of: dataAsOf,
      sources
    };
  }

  const symbolProfile = existing?.SymbolProfile as Record<string, unknown> | undefined;
  const dataSource = asString(params.dataSource) ?? asString(symbolProfile?.dataSource) ?? 'YAHOO';
  const symbol = asString(params.symbol) ?? asString(symbolProfile?.symbol);
  const type = asString(params.type) ?? asString(existing?.type);
  const currency = asString(params.currency) ?? asString(existing?.currency);
  const dateStr = asString(params.date) ?? asString(existing?.date);

  if (!symbol || !type || !currency || !dateStr) {
    return {
      success: false,
      answer: 'Could not determine symbol, type, currency, or date for this order. Please specify the fields you want to change.',
      summary: 'Incomplete order data',
      data_as_of: dataAsOf,
      sources
    };
  }

  const quantity = asNumber(params.quantity) ?? asNumber(existing?.quantity);
  const unitPrice = asNumber(params.unitPrice) ?? asNumber(existing?.unitPrice);
  const fee = asNumber(params.fee) ?? asNumber(existing?.fee);

  if (quantity === undefined || unitPrice === undefined || fee === undefined) {
    return {
      success: false,
      answer: 'Could not determine quantity, unit price, or fee for this order.',
      summary: 'Incomplete order data',
      data_as_of: dataAsOf,
      sources
    };
  }

  const dto: UpdateOrderDtoBody = {
    id: orderId,
    type,
    symbol,
    dataSource,
    currency,
    date: dateStr,
    quantity,
    unitPrice,
    fee,
    updateAccountBalance: true
  };
  if (params.accountId?.trim()) dto.accountId = params.accountId.trim();
  if (params.comment !== undefined) dto.comment = params.comment?.trim() ?? undefined;
  if (Array.isArray(params.tags)) dto.tags = params.tags.filter((t) => typeof t === 'string');

  try {
    await client.updateOrder(orderId, dto, { token });
    return {
      success: true,
      answer: `Updated order ${orderId} (${type} ${symbol}).`,
      summary: `Updated order ${orderId}`,
      data_as_of: dataAsOf,
      sources
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      answer: `Could not update order: ${message}. Please check the data and try again.`,
      summary: `Update order failed: ${message}`,
      data_as_of: dataAsOf,
      sources
    };
  }
}
