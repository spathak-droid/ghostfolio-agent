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
    name: 'market_data',
    description:
      'Use when the user asks for current price, price change, or "difference from today to last month" for specific symbols (e.g. bitcoin, AAPL, Tesla). ' +
      'Use for historical price requests (e.g. "how much was BTC in February 2025?" or "price in 2024") when the date is in the past relative to today. ' +
      'Accepts symbols[] (names or tickers) and metrics[] (price, change_1m, change_percent_1m). ' +
      'Resolves names via symbol lookup; returns current price and optional 1-month change. ' +
      'Good for: "What is the price of bitcoin?", "How much was BTC price 2025 february?", "Current price of AAPL".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbols: { type: 'array', description: 'Symbol names or tickers, e.g. ["bitcoin"], ["AAPL"]' },
        metrics: {
          type: 'array',
          description: 'Requested metrics: price, change_1m, change_percent_1m'
        }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Per-symbol current price and optional 1-month change metrics',
      properties: {
        symbols: {
          type: 'array',
          description: 'Array of { symbol, dataSource, currentPrice, currency, change1m?, changePercent1m?, error? }'
        },
        summary: { type: 'string', description: 'Short summary' },
        answer: { type: 'string', description: 'Natural-language answer for the user' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers' }
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
  },
  {
    name: 'create_order',
    description:
      'Use when the user wants to add a buy, sell, dividend, or other activity (e.g. "I want to buy Apple", "Record a sell of 5 BTC", "Add a dividend"). ' +
      'Requires symbol and type; for BUY/SELL also requires quantity. Do not invent unit price—leave blank so the tool fetches current price from market data. Always pass updateAccountBalance: true. ' +
      'If required fields are missing, the tool returns a clarification question; ask the user and call again with the new info. ' +
      'Good for: "Buy Apple shares", "I want to purchase 10 Tesla", "Add a buy order", "Record that I sold X".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbol: { type: 'string', description: 'Ticker or name (e.g. AAPL, Apple)' },
        type: { type: 'string', description: 'BUY | SELL | DIVIDEND | FEE | INTEREST | LIABILITY' },
        quantity: { type: 'number', description: 'Required for BUY/SELL' },
        unitPrice: { type: 'number', description: 'Optional; tool fetches from market data if missing' },
        date: { type: 'string', description: 'ISO date; default today' },
        currency: { type: 'string', description: 'e.g. USD; default from user base currency' },
        fee: { type: 'number', description: 'Optional; default 0' },
        accountId: { type: 'string', description: 'Optional account to link' },
        dataSource: { type: 'string', description: 'Optional (e.g. YAHOO, MANUAL)' },
        comment: { type: 'string', description: 'Optional comment' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Create order result or clarification request',
      properties: {
        success: { type: 'boolean', description: 'Whether the order was created or clarification was returned' },
        orderId: { type: 'string', description: 'Created order id when success' },
        needsClarification: { type: 'boolean', description: 'True when required fields are missing' },
        missingFields: { type: 'array', description: 'List of missing field names' },
        answer: { type: 'string', description: 'Natural-language reply or follow-up question' },
        summary: { type: 'string', description: 'Short summary' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: false
  },
  {
    name: 'update_order',
    description:
      'Use when the user wants to edit an existing order/activity (e.g. "Update my last order", "Change the quantity of order X", "Edit activity id Y"). ' +
      'Requires orderId. Always updateAccountBalance: true. Ask for order id if missing. ' +
      'Good for: "Update order", "Edit activity", "Change my buy of AAPL".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        orderId: { type: 'string', description: 'Required; activity/order id to update' },
        date: { type: 'string', description: 'ISO date' },
        quantity: { type: 'number', description: 'New quantity' },
        unitPrice: { type: 'number', description: 'New unit price' },
        fee: { type: 'number', description: 'New fee' },
        currency: { type: 'string', description: 'Currency' },
        symbol: { type: 'string', description: 'Symbol' },
        type: { type: 'string', description: 'Activity type' },
        dataSource: { type: 'string', description: 'Data source' },
        accountId: { type: 'string', description: 'Account id' },
        comment: { type: 'string', description: 'Comment' },
        tags: { type: 'array', description: 'Tag ids' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Update order result or clarification request',
      properties: {
        success: { type: 'boolean', description: 'Whether the order was updated or clarification was returned' },
        needsClarification: { type: 'boolean', description: 'True when orderId or required fields missing' },
        missingFields: { type: 'array', description: 'List of missing field names' },
        answer: { type: 'string', description: 'Natural-language reply or follow-up question' },
        summary: { type: 'string', description: 'Short summary' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: false
  }
] as const;

export type RegisteredToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

// ---------------------------------------------------------------------------
// LLM-facing helpers (selectable tools exclude get_transactions)
// ---------------------------------------------------------------------------

/** Tool names the LLM can select (get_transactions is internal). */
export const SELECTABLE_TOOL_NAMES: readonly AgentToolName[] = [
  'portfolio_analysis',
  'market_data',
  'market_data_lookup',
  'transaction_categorize',
  'transaction_timeline',
  'create_order',
  'update_order'
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
