/**
 * Purpose: Defensive validation of tool arguments before execution.
 * Inputs: tool name and the args object passed to executeTool.
 * Outputs: ok or a single error message for orchestration to surface.
 * Use: Call before executeTool so any code path (including future callers) is forced through the same rules.
 */

import type { AgentToolName } from '../types';
import {
  MAX_ARRAY_LENGTH,
  MAX_STRING_FIELD_LENGTH,
  optionalDate,
  RANGE_VALUES,
  SYMBOL_PATTERN,
  TAKE_MAX,
  TAKE_MIN
} from './common';

export type ValidateToolArgsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validates tool arguments using the same rules as the chat/order validators.
 * Returns ok or a single error message (no PII or raw values).
 */
export function validateToolArgs(
  toolName: AgentToolName,
  args: {
    dateFrom?: string;
    dateTo?: string;
    range?: string;
    regulations?: string[];
    symbol?: string;
    symbols?: string[];
    take?: number;
  }
): ValidateToolArgsResult {
  const { dateFrom, dateTo, range, regulations, symbol, symbols, take } = args;

  if (take !== undefined && take !== null) {
    if (typeof take !== 'number' || !Number.isFinite(take)) {
      return { ok: false, error: 'take must be a finite number.' };
    }
    const takeInt = Math.floor(take);
    if (takeInt < TAKE_MIN || takeInt > TAKE_MAX) {
      return { ok: false, error: `take must be between ${TAKE_MIN} and ${TAKE_MAX}.` };
    }
  }

  const fromDate = optionalDate(dateFrom);
  if (
    dateFrom !== undefined &&
    dateFrom !== null &&
    typeof dateFrom === 'string' &&
    dateFrom.trim().length > 0 &&
    fromDate === undefined
  ) {
    return { ok: false, error: 'dateFrom must be YYYY-MM-DD.' };
  }

  const toDate = optionalDate(dateTo);
  if (
    dateTo !== undefined &&
    dateTo !== null &&
    typeof dateTo === 'string' &&
    dateTo.trim().length > 0 &&
    toDate === undefined
  ) {
    return { ok: false, error: 'dateTo must be YYYY-MM-DD.' };
  }

  if (fromDate && toDate && fromDate > toDate) {
    return { ok: false, error: 'dateFrom must be before or equal to dateTo.' };
  }

  if (range !== undefined && range !== null && typeof range === 'string' && range.trim()) {
    const r = range.trim();
    if (!RANGE_VALUES.includes(r as (typeof RANGE_VALUES)[number])) {
      return { ok: false, error: `range must be one of ${RANGE_VALUES.join(', ')}.` };
    }
  }

  if (symbol !== undefined && symbol !== null && typeof symbol === 'string' && symbol.trim()) {
    const s = symbol.trim();
    if (s.length > MAX_STRING_FIELD_LENGTH || !SYMBOL_PATTERN.test(s)) {
      return { ok: false, error: 'symbol must match allowed pattern and length.' };
    }
  }

  if (Array.isArray(symbols)) {
    if (symbols.length > MAX_ARRAY_LENGTH) {
      return { ok: false, error: `symbols must have at most ${MAX_ARRAY_LENGTH} items.` };
    }
    for (let i = 0; i < symbols.length; i++) {
      const s = typeof symbols[i] === 'string' ? (symbols[i] as string).trim() : '';
      if (s.length === 0 || s.length > MAX_STRING_FIELD_LENGTH || !SYMBOL_PATTERN.test(s)) {
        return { ok: false, error: `symbols[${i}] must be a valid symbol.` };
      }
    }
  }

  if (Array.isArray(regulations)) {
    if (regulations.length > MAX_ARRAY_LENGTH) {
      return { ok: false, error: `regulations must have at most ${MAX_ARRAY_LENGTH} items.` };
    }
    for (let i = 0; i < regulations.length; i++) {
      const r = typeof regulations[i] === 'string' ? (regulations[i] as string).trim() : '';
      if (r.length === 0 || r.length > MAX_STRING_FIELD_LENGTH * 2) {
        return { ok: false, error: `regulations[${i}] must be a non-empty string within length limit.` };
      }
    }
  }

  void toolName;
  return { ok: true };
}
