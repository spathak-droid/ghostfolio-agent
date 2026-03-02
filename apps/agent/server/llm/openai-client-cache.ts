/**
 * Purpose: LLM cache key building, get/set helpers, and compliance facts parsing.
 * Used by openai-client and openai-client-impl.
 */

import { createHash } from 'crypto';
import type { ComplianceFacts } from '../types';
import type { LlmCacheStore } from './llm-cache';

export function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

export function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildCacheKey({
  message,
  model,
  operation,
  requestUrl,
  toolNames,
  window
}: {
  message: string;
  model: string;
  operation: 'extract_compliance_facts' | 'select_tool';
  requestUrl: string;
  toolNames?: string[];
  window?: { content: string; role: 'assistant' | 'user' }[];
}): string {
  const payload = {
    message: normalizeText(message),
    model,
    operation,
    requestUrl,
    toolNames: toolNames?.slice().sort(),
    window: window?.map(({ content, role }) => ({ content: normalizeText(content), role }))
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `llm_cache:${operation}:${digest}`;
}

export async function getCachedJson<T>(
  cache: LlmCacheStore | undefined,
  key: string
): Promise<T | undefined> {
  if (!cache) return undefined;
  try {
    const value = await cache.get(key);
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export async function setCachedJson(
  cache: LlmCacheStore | undefined,
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  if (!cache) return;
  try {
    await cache.set(key, JSON.stringify(value), ttlSeconds);
  } catch {
    // Ignore cache write errors to keep LLM path fail-open.
  }
}

export function parseComplianceFacts(
  input: Record<string, unknown>
): Partial<ComplianceFacts> | undefined {
  const result: Partial<ComplianceFacts> = {};
  if (typeof input.alternative_minimum_tax_topic === 'boolean') {
    result.alternative_minimum_tax_topic = input.alternative_minimum_tax_topic;
  }
  if (typeof input.capital_gains_topic === 'boolean') {
    result.capital_gains_topic = input.capital_gains_topic;
  }
  if (typeof input.concentration_risk === 'boolean') {
    result.concentration_risk = input.concentration_risk;
  }
  if (typeof input.constraints === 'boolean') {
    result.constraints = input.constraints;
  }
  if (typeof input.cost_basis_topic === 'boolean') {
    result.cost_basis_topic = input.cost_basis_topic;
  }
  if (typeof input.etf_tax_efficiency_topic === 'boolean') {
    result.etf_tax_efficiency_topic = input.etf_tax_efficiency_topic;
  }
  if (typeof input.horizon === 'boolean') {
    result.horizon = input.horizon;
  }
  if (typeof input.ira_contribution_limits_topic === 'boolean') {
    result.ira_contribution_limits_topic = input.ira_contribution_limits_topic;
  }
  if (typeof input.is_recommendation === 'boolean') {
    result.is_recommendation = input.is_recommendation;
  }
  if (typeof input.net_investment_income_tax_topic === 'boolean') {
    result.net_investment_income_tax_topic = input.net_investment_income_tax_topic;
  }
  if (typeof input.quote_is_fresh === 'boolean') {
    result.quote_is_fresh = input.quote_is_fresh;
  }
  if (typeof input.quote_staleness_check === 'boolean') {
    result.quote_staleness_check = input.quote_staleness_check;
  }
  if (typeof input.qualified_dividends_topic === 'boolean') {
    result.qualified_dividends_topic = input.qualified_dividends_topic;
  }
  if (typeof input.required_minimum_distributions_topic === 'boolean') {
    result.required_minimum_distributions_topic = input.required_minimum_distributions_topic;
  }
  if (typeof input.replacement_buy_signal === 'boolean') {
    result.replacement_buy_signal = input.replacement_buy_signal;
  }
  if (input.realized_pnl === 'LOSS' || input.realized_pnl === 'GAIN') {
    result.realized_pnl = input.realized_pnl;
  }
  if (typeof input.risk_tolerance === 'boolean') {
    result.risk_tolerance = input.risk_tolerance;
  }
  if (typeof input.tax_loss_harvesting_topic === 'boolean') {
    result.tax_loss_harvesting_topic = input.tax_loss_harvesting_topic;
  }
  if (input.transaction_type === 'BUY' || input.transaction_type === 'SELL') {
    result.transaction_type = input.transaction_type;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
