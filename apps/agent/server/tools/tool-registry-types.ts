/**
 * Shared types and reusable input/error schemas for the tool registry.
 * Used by tool-registry-definitions.ts and tool-registry.ts.
 */

import type { AgentToolName } from '../types';

/** Per-tool error contract: error_code, message, retryable. */
export interface ToolErrorModel {
  error_code: string;
  message: string;
  retryable: boolean;
}

/** JSON Schema-like input for the tool. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

/** JSON Schema-like output description (documents API response shape). */
export interface ToolOutputSchema {
  type: 'object';
  description?: string;
  properties?: Record<string, { type: string; description?: string }>;
}

/** Full tool definition: name, description, input/output schema, error model. */
export interface ToolDefinition {
  name: AgentToolName;
  /** Rich description for LLM: when to use, example intents, what the tool returns. */
  description: string;
  input_schema: ToolInputSchema;
  output_schema: ToolOutputSchema;
  error_model: ToolErrorModel;
  /** Whether the tool can be safely retried (AGENTS.md 4.2). */
  idempotent: boolean;
}

/** Reusable common input schema (message, impersonationId, token). */
export const COMMON_INPUT: ToolInputSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'User message or query' },
    impersonationId: { type: 'string', description: 'Optional user/account context for impersonation' },
    token: { type: 'string', description: 'Bearer token for Ghostfolio API' }
  },
  required: ['message']
};

/** Reusable input schema for transaction-dependent tools (adds dateFrom, dateTo, symbol, type, wantsLatest, transactions). */
export const TRANSACTION_INPUT: ToolInputSchema = {
  type: 'object',
  properties: {
    ...COMMON_INPUT.properties,
    dateFrom: { type: 'string', description: 'Optional inclusive start date filter (YYYY-MM-DD)' },
    dateTo: { type: 'string', description: 'Optional inclusive end date filter (YYYY-MM-DD)' },
    symbol: { type: 'string', description: 'Optional symbol filter (e.g. TSLA, BTCUSD)' },
    type: {
      type: 'string',
      description: 'Optional transaction type filter (BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY)'
    },
    wantsLatest: { type: 'boolean', description: 'Optional: return only the most recent transaction' },
    transactions: {
      type: 'array',
      description: 'Pre-fetched transactions from get_transactions (activities from GET /order)'
    }
  },
  required: ['message']
};

/** Default tool error model for tool definitions. */
export const TOOL_ERROR: ToolErrorModel = {
  error_code: 'TOOL_EXECUTION_FAILED',
  message: 'Tool execution failed',
  retryable: true
};
