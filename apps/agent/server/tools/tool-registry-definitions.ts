/**
 * Tool definitions array (aligned with ghostfolio-api-response-schemas.md).
 * Single source for the TOOL_DEFINITIONS list; types and shared schemas live in tool-registry-types.ts.
 */

import type { ToolDefinition } from './tool-registry-types';
import { COMMON_INPUT, TRANSACTION_INPUT, TOOL_ERROR } from './tool-registry-types';

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'compliance_check',
    description:
      'Use when the user asks for compliance, policy checks, regulation validation, or whether a transaction/recommendation is allowed. ' +
      'Evaluates deterministic policy rules and returns violations and warnings with source metadata. ' +
      'Good for: "is this compliant?", "check regulations for this order", "run policy check".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        regulations: {
          type: 'array',
          description: 'Optional list of regulation rule IDs to restrict checks (e.g. R-FINRA-2111)'
        },
        symbol: { type: 'string', description: 'Optional ticker symbol (e.g. AAPL)' },
        type: { type: 'string', description: 'Optional transaction type (BUY, SELL, etc.)' },
        quantity: { type: 'number', description: 'Optional order quantity' },
        unitPrice: { type: 'number', description: 'Optional unit price' },
        currency: { type: 'string', description: 'Optional currency code' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Compliance check result with blocking violations and warnings',
      properties: {
        success: { type: 'boolean', description: 'Whether compliance check execution succeeded' },
        isCompliant: { type: 'boolean', description: 'True when no blocking violations were found' },
        violations: { type: 'array', description: 'Blocking policy findings' },
        warnings: { type: 'array', description: 'Non-blocking policy findings' },
        policyVersion: { type: 'string', description: 'Policy pack version used for evaluation' },
        data_as_of: { type: 'string', description: 'Policy data timestamp' },
        sources: { type: 'array', description: 'Regulation source URLs used in findings' },
        summary: { type: 'string', description: 'Short summary of findings' },
        answer: { type: 'string', description: 'Natural-language result' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'fact_check',
    description:
      'Use when the user asks to verify, double-check, or fact-check a price or market data claim. ' +
      'Compares Ghostfolio (primary) with Yahoo Finance (second source) for both stocks and crypto symbols and returns match/mismatch with provenance. ' +
      'Good for: "verify bitcoin price", "fact check the price of AAPL", "confirm current price of ETH". ' +
      'Requires symbols to be explicitly specified (pre-resolved upstream); if no symbols provided, asks the user to specify them.',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbols: { type: 'array', description: 'Symbol names or tickers to verify (e.g. ["AAPL"], ["BTC-USD"], ["ETH-USD"])' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Fact-check result: match, primary and secondary data, discrepancy if any, sources',
      properties: {
        match: { type: 'boolean', description: 'True when primary and secondary prices agree within tolerance (or no second source)' },
        primary: { type: 'object', description: 'Primary result from Ghostfolio (symbols with prices)' },
        secondary: { type: 'object', description: 'Secondary result from Yahoo Finance or null' },
        discrepancy: { type: 'string', description: 'Human-readable discrepancy when match is false' },
        comparisons: { type: 'array', description: 'Per-symbol comparison details' },
        answer: { type: 'string', description: 'Natural-language verdict' },
        sources: { type: 'array', description: 'Source identifiers (ghostfolio_api, yahoo_finance)' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        summary: { type: 'string', description: 'Short summary' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'tax_estimate',
    description:
      'Use when the user asks to estimate taxes from portfolio activities, realized gains/losses, dividends, or interest. ' +
      'Computes a deterministic estimate from recorded transactions (FIFO lots) using local federal tax tables. ' +
      'When filing status, tax year, or ordinary income are not provided, the tool returns missing_params and an answer that asks the user for those details; surface that answer so the user can supply the information. ' +
      'Good for: "estimate my taxes", "capital gains tax estimate", "tax on my trades and dividends".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        range: { type: 'string', description: 'Optional Ghostfolio range (e.g. max, ytd, 1y)' },
        take: { type: 'number', description: 'Optional max activities to load (default 200)' },
        conversation_history: {
          type: 'array',
          description:
            'Optional full conversation history (array of {role: "user"|"assistant", content: string}) for context when extracting parameters from follow-up messages'
        }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Tax estimate with realized gains/losses, income totals, and federal tax breakdown',
      properties: {
        success: { type: 'boolean', description: 'Whether estimate execution succeeded' },
        tax_year: { type: 'number', description: 'Tax year used for table lookup' },
        filing_status: { type: 'string', description: 'Filing status used in calculation' },
        missing_params: {
          type: 'array',
          description:
            'When present, parameters were not provided by the user; the answer asks for these. Each item has param (e.g. tax_year, filing_status, ordinary_income) and question (string to ask the user).'
        },
        realized: { type: 'object', description: 'Short/long-term gains and losses with net capital result' },
        income: { type: 'object', description: 'Dividend and interest totals from activities' },
        estimate: { type: 'object', description: 'Federal tax components and total estimate' },
        assumptions: { type: 'array', description: 'Assumptions and data-quality notes' },
        summary: { type: 'string', description: 'Short summary' },
        answer: { type: 'string', description: 'Natural-language result; when missing_params is present, includes questions for the user' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers and tax table path' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'fact_compliance_check',
    description:
      'Use only when the user explicitly asks for both fact verification and compliance/regulation validation in one request. ' +
      'Runs fact_check and compliance_check together and returns nested sections for each, plus a combined verdict and provenance. ' +
      'Good for: "verify BTC price and check if this is compliant", "fact-check this claim and run compliance check".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbols: { type: 'array', description: 'Optional symbols for fact checking (e.g. ["BTC"], ["ETH"])' },
        regulations: {
          type: 'array',
          description: 'Optional rule IDs to restrict compliance checks (e.g. R-FINRA-2111)'
        },
        type: { type: 'string', description: 'Optional transaction type context (BUY, SELL, etc.)' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Combined result with nested fact_check and compliance_check sections',
      properties: {
        success: { type: 'boolean', description: 'True unless both sub-checks failed' },
        fact_check: { type: 'object', description: 'Nested fact_check result' },
        compliance_check: { type: 'object', description: 'Nested compliance_check result (optionally with regulation excerpts)' },
        answer: { type: 'string', description: 'Natural-language combined verdict' },
        summary: { type: 'string', description: 'Short combined summary' },
        sources: { type: 'array', description: 'Deduplicated source identifiers and URLs' },
        data_as_of: { type: 'string', description: 'Most recent available timestamp across both checks' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'portfolio_analysis',
    description:
      'Use when the user asks for portfolio performance trend, net performance, net worth, or high-level returns over time. ' +
      'Calls GET /api/v2/portfolio/performance?range=max and returns normalized performance fields plus the raw chart/performance payload. ' +
      'Good for: "How is my portfolio performing?", "Show performance over time", "What is my current net worth?", "What is my return?". ' +
      'For holdings/allocation/cash breakdown, use holdings_analysis. ' +
      'Do NOT use to execute transactions or edit activities; use create_order (or create_other_activities) only for explicit execution requests.',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'Portfolio performance payload from GET /api/v2/portfolio/performance?range=max',
      properties: {
        allocation: {
          type: 'array',
          description: 'Always empty for portfolio_analysis; use holdings_analysis for allocation'
        },
        performance: {
          type: 'object',
          description:
            'Normalized performance: portfolio = current portfolio value; balance = current net worth; totalInvestment = total invested (cost basis); netPerformance, netPerformancePercentage'
        },
        data_as_of: { type: 'string', description: 'ISO timestamp of data' },
        summary: { type: 'string', description: 'Short human-readable summary' },
        sources: { type: 'array', description: 'Source identifiers, e.g. ghostfolio_api' },
        data: {
          type: 'object',
          description: 'Raw GET /api/v2/portfolio/performance payload (chart, firstOrderDate, performance, errors)'
        }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'holdings_analysis',
    description:
      'Use when the user asks for holdings, allocation, cash vs investments, account balances, or platform balances. ' +
      'Calls GET /api/v1/portfolio/holdings?range=max and returns allocation plus normalized holdings performance/cash fields. ' +
      'Good for: "What do I hold?", "What is my allocation?", "How much cash do I have?", "Show account balances".',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'Portfolio holdings payload from GET /api/v1/portfolio/holdings?range=max',
      properties: {
        allocation: { type: 'object', description: 'Normalized holdings allocation by symbol' },
        performance: {
          type: 'object',
          description: 'Normalized summary performance (portfolio, balance, netPerformance, etc.)'
        },
        data_as_of: { type: 'string', description: 'ISO timestamp of data' },
        summary: { type: 'string', description: 'Short human-readable summary' },
        sources: { type: 'array', description: 'Source identifiers, e.g. ghostfolio_api' },
        data: {
          type: 'object',
          description:
            'Raw API response: accounts, summary, platforms, holdings'
        }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'static_analysis',
    description:
      'Use when the user asks for portfolio risks, potential issues, x-ray report, or static analysis. ' +
      'Calls GET /api/v1/portfolio/report and returns x-ray categories (liquidity, emergency fund, currency/asset/account/regional cluster risks, fees). ' +
      'Rules with value false are potential risks; value true is good. ' +
      'Good for: "check potential risks", "any risks in my portfolio?", "regional risk", "asset class risk", "portfolio report", "x-ray".',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'Portfolio report (x-ray) with categories, rules, and risks (rules where value is false)',
      properties: {
        success: { type: 'boolean', description: 'Whether the report was fetched successfully' },
        xRay: {
          type: 'object',
          description: 'Raw x-ray: categories (key, name, rules with evaluation, value, key, name), statistics'
        },
        risks: {
          type: 'array',
          description: 'Potential risks: rules where value is false (categoryKey, categoryName, ruleKey, ruleName, evaluation)'
        },
        statistics: {
          type: 'object',
          description: 'rulesActiveCount, rulesFulfilledCount'
        },
        summary: { type: 'string', description: 'Short human-readable summary of risks/status' },
        data_as_of: { type: 'string', description: 'ISO timestamp of report' },
        sources: { type: 'array', description: 'Source identifiers, e.g. ghostfolio_api' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'market_data',
    description:
      'Use when the user asks for current price/quote of specific symbols (e.g. bitcoin, AAPL, Tesla). ' +
      'This tool is current-only and does not provide historical comparisons. ' +
      'Accepts symbols[] (names or tickers) and metrics[]; currently supports metric "price" only. Unsupported metrics are ignored and reported. ' +
      'Resolves names via symbol lookup and returns current price. ' +
      'Good for: "What is the price of bitcoin?", "Current price of AAPL", "quote for TSLA". ' +
      'Do NOT use for transaction history or ratio analytics; use transaction_categorize or transaction_timeline.',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbols: { type: 'array', description: 'Symbol names or tickers, e.g. ["bitcoin"], ["AAPL"]' },
        metrics: {
          type: 'array',
          description:
            'Requested metrics. Supported in current-only mode: price'
        }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Per-symbol current price (current-only mode)',
      properties: {
        symbols: {
          type: 'array',
          description: 'Array of { symbol, dataSource, currentPrice, currency, error? }'
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
    name: 'analyze_stock_trend',
    description:
      'Use when the user asks how a specific holding is doing over time (e.g. "how is my bitcoin doing", "BTC trend in last 7 days"). ' +
      'Calls GET /api/v1/portfolio/holding/:dataSource/:symbol and analyzes historicalData for a selected timeline window (7d/30d/90d/1y/max). ' +
      'Returns period change, high/low in window, and since-entry change vs averagePrice. ' +
      'Good for: "trend for BTC", "how much did it grow last week", "show my BTC 30-day change".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbol: { type: 'string', description: 'Asset name or ticker, e.g. bitcoin, BTCUSD, AAPL' },
        range: { type: 'string', description: 'Timeline window: 7d, 30d, 90d, 1y, max' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Holding trend analysis from GET /api/v1/portfolio/holding/:dataSource/:symbol',
      properties: {
        answer: { type: 'string', description: 'Natural-language trend analysis' },
        summary: { type: 'string', description: 'Short trend summary' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        range: { type: 'string', description: 'Resolved timeline window used for analysis' },
        chart: {
          type: 'object',
          description: 'Normalized chart data for rendering: points[] with { date, price } and range'
        },
        performance: {
          type: 'object',
          description:
            'Normalized performance metrics: currentPrice, periodChange, periodChangePercent, sinceEntryChange, sinceEntryChangePercent'
        },
        trend: {
          type: 'object',
          description:
            'Computed metrics: currentPrice, periodChange, periodChangePercent, sinceEntryChange, sinceEntryChangePercent, windowHigh, windowLow'
        },
        data: { type: 'object', description: 'Raw holding payload including historicalData' },
        sources: { type: 'array', description: 'Source identifiers' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'market_data_lookup',
    description:
      'Calls GET /api/v1/market-data/markets. Returns only Fear & Greed Index (CRYPTOCURRENCIES and STOCKS) from Ghostfolio—no symbol parameter, no per-symbol prices. ' +
      'Use for: "How is the market sentiment?", "Fear and greed index". Do NOT use for "price of X" or "quote for AAPL"—use market_data instead. ' +
      'Do NOT use for user transaction analysis.',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'Response: fearAndGreedIndex { CRYPTOCURRENCIES, STOCKS } with marketPrice, historicalData',
      properties: {
        data: { type: 'object', description: 'Raw payload: fearAndGreedIndex.CRYPTOCURRENCIES and .STOCKS' },
        summary: { type: 'string', description: 'Short summary of the lookup' },
        source: { type: 'string', description: 'Source identifier' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  },
  {
    name: 'market_overview',
    description:
      'Use when the user asks for broad market condition, sentiment, or "which markets are doing good/bad right now". ' +
      'Calls GET /api/v1/market-data/markets and summarizes fear & greed levels for STOCKS and CRYPTOCURRENCIES. ' +
      'Good for: "market overview", "how are markets doing?", "is market sentiment fear or greed?". ' +
      'Do NOT use for order execution or personal transaction history.',
    input_schema: COMMON_INPUT,
    output_schema: {
      type: 'object',
      description: 'Market overview based on fearAndGreedIndex from Ghostfolio market endpoint',
      properties: {
        answer: { type: 'string', description: 'Natural-language market overview' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        overview: {
          type: 'object',
          description:
            'Normalized sentiment for stocks and cryptocurrencies: { stocks: { value, label }, cryptocurrencies: { value, label } }'
        },
        summary: { type: 'string', description: 'Short summary' },
        sources: { type: 'array', description: 'Source identifiers' },
        data: { type: 'object', description: 'Raw GET /market-data/markets payload' }
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
      'Select transaction_categorize or transaction_timeline when the user asks about transaction history, categorization, buy/sell ratios, or "when did I buy/sell".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        range: { type: 'string', description: 'Optional Ghostfolio range parameter (default: max)' },
        take: { type: 'number', description: 'Optional max activities to fetch (default: 200)' }
      },
      required: ['message']
    },
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
      'Understands optional filters from message for symbol, type, and date range (e.g. year, last year, this month, last N days). ' +
      'Returns categories with counts/totals and pattern metrics (buy/sell ratio, 30d activity trend, average trade size, concentration, fee drag), plus a short answer. ' +
      'Good for: "Categorize my transactions", "Break down my transactions by type", "Summarize my activity", "What is my buy/sell ratio?". ' +
      'Do NOT use create_order for analytical phrases containing buy/sell terms (e.g. "buy sell ratio", "buy vs sell breakdown").',
    input_schema: TRANSACTION_INPUT,
    output_schema: {
      type: 'object',
      description: 'Categorization result: categories array, summary, assumptions',
      properties: {
        categories: {
          type: 'array',
          description: 'Array of { category, count, totalValue } (e.g. BUY, SELL, DIVIDEND)'
        },
        patterns: {
          type: 'object',
          description:
            'Pattern metrics: buySellRatio, activityTrend30dVsPrev30dPercent, averageTradeSize, topSymbolByCount, feeDragPercent'
        },
        computed: {
          type: 'array',
          description: 'Derived metric formulas and results for transparency'
        },
        missing_data: {
          type: 'array',
          description: 'Pattern metrics that could not be computed and why'
        },
        filters: {
          type: 'object',
          description: 'Applied symbol/type/date filters and matchedCount'
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
      'Use when the user asks when they bought or sold something, at what price, or for the last/latest transaction. which year did they buy or sell something? ' +
      'Requires transactions: run get_transactions first (orchestrator does this automatically). ' +
      'Supports optional filters by symbol, type, and date range. ' +
      'Returns a timeline of matching transactions (date, symbol, type, quantity, unitPrice). ' +
      'Good for: "When did I buy AAPL?", "When did I sell X?", "At what price did I buy?", "Last transaction", "Latest transaction". ' +
      'For ratio/count analytics (buy vs sell counts), use transaction_categorize.',
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
      'Use when the user wants to add a BUY or SELL trade (e.g. "I want to buy Apple", "Record a sell of 5 BTC"). ' +
      'Requires symbol and type; for BUY/SELL requires quantity. Do not invent unit price—leave blank so the tool fetches current price from market data. Always pass updateAccountBalance: true. ' +
      'If required fields are missing, the tool returns a clarification question; ask the user and call again with the new info. ' +
      'Good for: "Buy Apple shares", "I want to purchase 10 Tesla", "Add a buy order", "Record that I sold X". ' +
      'Never use for analytics/questions about existing history (e.g. buy/sell ratio, transaction breakdown, when did I buy/sell); use transaction_categorize or transaction_timeline instead. ' +
      'For DIVIDEND/FEE/INTEREST/LIABILITY use create_other_activities.',
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
        symbolOptions: {
          type: 'array',
          description:
            'Optional top symbol candidates when the provided symbol is ambiguous. Each item contains label and symbol for user selection.'
        },
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
    name: 'create_other_activities',
    description:
      'Use when the user wants to add non-trade activities: DIVIDEND, FEE, INTEREST, LIABILITY. ' +
      'Requires type (one of DIVIDEND/FEE/INTEREST/LIABILITY), symbol, and amount (unitPrice). Quantity defaults to 1 if omitted. ' +
      'Always pass updateAccountBalance: true and ask follow-up clarifications when required fields are missing. ' +
      'Good for: "Add a dividend for AAPL", "Record account fee", "Add interest income", "Record liability charge". ' +
      'Do NOT use for BUY/SELL trades; use create_order.',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        symbol: { type: 'string', description: 'Ticker or name (e.g. AAPL, Apple)' },
        type: { type: 'string', description: 'DIVIDEND | FEE | INTEREST | LIABILITY' },
        unitPrice: { type: 'number', description: 'Amount to record for the activity' },
        quantity: { type: 'number', description: 'Optional quantity; defaults to 1' },
        date: { type: 'string', description: 'ISO date; default current timestamp' },
        currency: { type: 'string', description: 'e.g. USD; default from user base currency' },
        fee: { type: 'number', description: 'Optional fee; default 0' },
        accountId: { type: 'string', description: 'Optional account to link' },
        dataSource: { type: 'string', description: 'Optional (e.g. MANUAL)' },
        comment: { type: 'string', description: 'Optional comment' }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'Create non-trade activity result or clarification request',
      properties: {
        success: { type: 'boolean', description: 'Whether the activity was created or clarification was returned' },
        orderId: { type: 'string', description: 'Created activity id when success' },
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
    name: 'get_orders',
    description:
      'Use when the user wants to list or find activities (orders) by symbol or name—e.g. "list my orders for apple", "find my doge orders", "show my AAPL activities". ' +
      'Fetches activities from the portfolio and filters by that symbol/name. Returns matching orders with ids and details. ' +
      'Good for: "List my Apple orders", "Find my doge purchases", "Show activities for TSLA".',
    input_schema: {
      type: 'object',
      properties: {
        ...COMMON_INPUT.properties,
        message: {
          type: 'string',
          description:
            'User message: symbol or name to filter by (e.g. "apple", "doge", "AAPL").'
        }
      },
      required: ['message']
    },
    output_schema: {
      type: 'object',
      description: 'List of orders (activities) matching the filter, or empty with "I didn\'t find that" answer',
      properties: {
        success: { type: 'boolean', description: 'Whether the fetch succeeded' },
        orders: {
          type: 'array',
          description: 'Array of { id, symbol, type, date, quantity, unitPrice } for matching orders'
        },
        count: { type: 'number', description: 'Number of orders found' },
        answer: { type: 'string', description: 'Natural-language reply: found N orders / I didn\'t find any orders for X' },
        summary: { type: 'string', description: 'Short summary' },
        data_as_of: { type: 'string', description: 'ISO timestamp' },
        sources: { type: 'array', description: 'Source identifiers' }
      }
    },
    error_model: TOOL_ERROR,
    idempotent: true
  }
] as const;
