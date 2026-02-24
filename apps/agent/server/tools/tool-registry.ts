/**
 * Tool Registry
 *
 * Single source of truth for agent tools: schemas, descriptions, and error model.
 * Descriptions are written for LLM tool selection (reasonAboutQuery, selectTool).
 * Output schemas align with Ghostfolio API responses; see docs/agent/ghostfolio-api-response-schemas.md.
 *
 * Used by:
 * - openai-client.ts: getSelectableToolDefinitions(), formatToolsForLlm(), SELECTABLE_TOOL_NAMES (LLM prompts + parse)
 * - agent.ts: isTransactionDependentTool(), SELECTABLE_TOOL_NAMES, TRANSACTION_DEPENDENT_TOOL_NAMES (routing + keyword fallback)
 * - synthesis/tool-result-synthesizer.ts: getToolDefinition() (prefer tool answer/summary per output_schema)
 * - eval-runner.ts: SELECTABLE_TOOL_NAMES (EvalCase.expectedTool type)
 *
 * Execution is wired in index.ts; this file is metadata only.
 * Failure modes: unknown tool name → no executor; schema violations are not enforced at runtime.
 */

import type { AgentToolName } from '../types';

// ---------------------------------------------------------------------------
// Shared types (AGENTS.md 4.1)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Reusable input schemas
// ---------------------------------------------------------------------------

const COMMON_INPUT: ToolInputSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'User message or query' },
    impersonationId: { type: 'string', description: 'Optional user/account context for impersonation' },
    token: { type: 'string', description: 'Bearer token for Ghostfolio API' }
  },
  required: ['message']
};

const TRANSACTION_INPUT: ToolInputSchema = {
  type: 'object',
  properties: {
    ...COMMON_INPUT.properties,
    transactions: {
      type: 'array',
      description: 'Pre-fetched transactions from get_transactions (activities from GET /order)'
    }
  },
  required: ['message']
};

const TOOL_ERROR: ToolErrorModel = {
  error_code: 'TOOL_EXECUTION_FAILED',
  message: 'Tool execution failed',
  retryable: true
};

// ---------------------------------------------------------------------------
// Tool definitions (aligned with ghostfolio-api-response-schemas.md)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'portfolio_analysis',
    description:
      'Use when the user asks about their portfolio overview, allocation, performance, net worth, available balance, cash, or deposits. ' +
      'Calls GET /portfolio/details and returns accounts (with balance per account), holdings (per-symbol allocation, performance, quantity, value), platforms (with balance), and a summary (total value, cash, net performance, fees, dividends). ' +
      'Good for: "What is my balance?", "How much cash do I have?", "Available balance", "What did I deposit?", "How is my portfolio?", "What is my allocation?", "Show my performance", "What do I hold?"',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'PortfolioDetails: accounts, holdings map, summary, platforms; see GET /portfolio/details',
      properties: {
        allocation: { type: 'object', description: 'Normalized holdings allocation by symbol' },
        performance: { type: 'object', description: 'Normalized summary performance (netPerformance, totalValueInBaseCurrency, etc.)' },
        data_as_of: { type: 'string', description: 'ISO timestamp of data' },
        summary: { type: 'string', description: 'Short human-readable summary' },
        sources: { type: 'array', description: 'Source identifiers, e.g. ghostfolio_api' },
        data: {
          type: 'object',
          description:
            'Raw API response: accounts (balance, currency, name, valueInBaseCurrency per account), summary (cash, totalValueInBaseCurrency, netPerformance), platforms (balance per platform), holdings'
        }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'market_data_lookup',
    description:
      'Use when the user asks about market data, prices, or quotes (e.g. "What is the price of X?", "Market data for AAPL"). ' +
      'Calls GET /market-data/markets and returns market data from Ghostfolio. ' +
      'Good for: price lookups, quote requests, or general market data questions when portfolio-specific data is not required.',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'Market data response from GET /market-data/markets',
      properties: {
        data: { type: 'object', description: 'Raw market data payload' },
        summary: { type: 'string', description: 'Short summary of the lookup' },
        source: { type: 'string', description: 'Source identifier' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'get_transactions',
    description:
      'Fetches the user\'s transactions (activities) from Ghostfolio via GET /order. ' +
      'Returns a list of transactions: each has date, type (BUY, SELL, DIVIDEND, etc.), symbol, quantity, unitPrice, value, SymbolProfile. ' +
      'Do not select this tool alone for the user; it is used internally before transaction_categorize or transaction_timeline. ' +
      'Select transaction_categorize or transaction_timeline when the user asks about transaction history, categorization, or "when did I buy/sell".',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'ActivitiesResponse: activities array (transactions) + count; see Transactions in ghostfolio-api-response-schemas.md',
      properties: {
        transactions: {
          type: 'array',
          description: 'Array of Activity: id, date, type, quantity, unitPrice, value, SymbolProfile { symbol, name, dataSource }, etc.'
        },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        summary: { type: 'string', description: 'e.g. "Fetched N transactions from Ghostfolio"' },
        sources: { type: 'array', description: 'Source identifiers' },
        data: { type: 'object', description: 'Raw GET /order response { activities, count }' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'transaction_categorize',
    description:
      'Use when the user wants to categorize transactions, see a breakdown by type (buy, sell, dividend, etc.), or summarize "what transactions do I have?". ' +
      'Requires transactions: run get_transactions first (orchestrator does this automatically). ' +
      'Returns categories with counts and totals, plus a short answer. ' +
      'Good for: "Categorize my transactions", "Break down my transactions by type", "Summarize my activity".',
    input_schema: TRANSACTION_INPUT,
    output_schema: {
      type: 'object',
      description: 'Categorization result: categories array, summary, assumptions',
      properties: {
        categories: {
          type: 'array',
          description: 'Array of { category, count, totalValue } (e.g. BUY, SELL, DIVIDEND)'
        },
        summary: { type: 'string', description: 'Short summary of categorization' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers' },
        answer: { type: 'string', description: 'Natural-language answer for the user' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'transaction_timeline',
    description:
      'Use when the user asks when they bought or sold something, at what price, or for the last/latest transaction. ' +
      'Requires transactions: run get_transactions first (orchestrator does this automatically). ' +
      'Returns a timeline of matching transactions (date, symbol, type, quantity, unitPrice). ' +
      'Good for: "When did I buy AAPL?", "When did I sell X?", "At what price did I buy?", "Last transaction", "Latest transaction".',
    input_schema: TRANSACTION_INPUT,
    output_schema: {
      type: 'object',
      description: 'Timeline of matching transactions with date, symbol, type, unitPrice',
      properties: {
        timeline: {
          type: 'array',
          description: 'Array of { date, symbol, type, quantity, unitPrice }'
        },
        summary: { type: 'string', description: 'Short summary, e.g. "Found N matching transactions"' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers' },
        answer: { type: 'string', description: 'Natural-language answer for the user' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  }
] as const;

export type RegisteredToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

// ---------------------------------------------------------------------------
// LLM-facing helpers (selectable tools exclude get_transactions)
// ---------------------------------------------------------------------------

/** Tool names the LLM can select (get_transactions is internal). */
export const SELECTABLE_TOOL_NAMES: readonly AgentToolName[] = [
  'portfolio_analysis',
  'market_data_lookup',
  'transaction_categorize',
  'transaction_timeline'
];

/** Tools that require get_transactions to run first (orchestrator runs get_transactions then this). */
export const TRANSACTION_DEPENDENT_TOOL_NAMES: readonly AgentToolName[] = [
  'transaction_categorize',
  'transaction_timeline'
];

/** Definitions for tools the LLM can choose (excludes get_transactions). */
export function getSelectableToolDefinitions(): readonly ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((def) => def.name !== 'get_transactions');
}

/** Whether this tool needs the transactions list to be fetched first. */
export function isTransactionDependentTool(name: AgentToolName): boolean {
  return (TRANSACTION_DEPENDENT_TOOL_NAMES as readonly string[]).includes(name);
}

/** Look up a tool definition by name (for synthesis, validation, etc.). */
export function getToolDefinition(name: AgentToolName): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((def) => def.name === name);
}

/** Format tool list for LLM prompts: one line per tool, "name: description". */
export function formatToolsForLlm(definitions: readonly ToolDefinition[]): string {
  return definitions
    .map((d) => `${d.name}: ${d.description}`)
    .join('\n');
}
