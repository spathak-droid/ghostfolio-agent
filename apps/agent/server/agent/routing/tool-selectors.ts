/**
 * Tool selectors: Select and filter tools based on user intent.
 * Applies keyword matching, intent detection, and dependency ordering.
 */

import type { AgentToolName } from '../../types';
import { SELECTABLE_TOOL_NAMES } from '../../tools/tool-registry';
import { SELECTABLE_KEYWORD_HINTS } from '../routing-keywords';
import {
  isExplicitFactComplianceIntent,
  isExplicitComplianceCheckIntent,
  isExplicitOrderExecutionIntent
} from './intent-classifiers';

/**
 * Detect if message is just a ticker symbol (e.g., "AAPL", "BTC", "APPL").
 * Returns true if message is 2-5 uppercase letters, possibly with dashes or numbers.
 */
function isLikelySymbolQuery(message: string): boolean {
  const trimmed = message.trim();
  // Match patterns like: AAPL, BTC-USD, BTC, APPL, TSLA, ETH, SOL, NVDA
  return /^[A-Z]{2,5}(-[A-Z]{3})?$/.test(trimmed);
}

export function selectToolsByKeyword(message: string): AgentToolName[] {
  if (isExplicitFactComplianceIntent(message)) {
    return ['fact_compliance_check'];
  }

  const normalized = message.toLowerCase();
  const tools: AgentToolName[] = [];

  for (const toolName of SELECTABLE_TOOL_NAMES) {
    const hints = SELECTABLE_KEYWORD_HINTS[toolName];
    if (hints?.some((hint) => normalized.includes(hint))) {
      tools.push(toolName);
    }
  }

  // If no keywords matched but message looks like a symbol, select market_data
  // This handles cases like user responds with just "AAPL" or "BTC"
  if (tools.length === 0 && isLikelySymbolQuery(message)) {
    tools.push('market_data');
  }

  return [...new Set(tools)];
}

/** Removes order-execution tools (create_order, create_other_activities) when we should not offer them. Leaves get_orders (read-only list/find) intact. */
export function removeOrderTools(tools: AgentToolName[]): AgentToolName[] {
  return tools.filter(
    (tool) => tool !== 'create_order' && tool !== 'create_other_activities'
  );
}

function isNonTradeActivityIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return /\b(dividend|divident|fee|interest|liability|liabilty|liablity|mortgage|loan|debt)\b/.test(
    normalized
  );
}

export function normalizeOrderToolsForIntent({
  message,
  selectedTools
}: {
  message: string;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  if (!isNonTradeActivityIntent(message)) {
    return selectedTools;
  }

  const withoutCreateOrder = selectedTools.filter((tool) => tool !== 'create_order');
  if (!withoutCreateOrder.includes('create_other_activities')) {
    return ['create_other_activities', ...withoutCreateOrder];
  }
  return withoutCreateOrder;
}

export function preventComplianceBlockingSpecializedTools({
  message,
  selectedTools
}: {
  message: string;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  // If tax_estimate is selected and compliance wasn't explicitly asked for, remove compliance
  if (selectedTools.includes('tax_estimate') && selectedTools.includes('compliance_check')) {
    if (!isExplicitComplianceCheckIntent(message)) {
      return selectedTools.filter((tool) => tool !== 'compliance_check');
    }
  }
  return selectedTools;
}

/**
 * fact_check depends on market_data to resolve symbols.
 * If both are selected, ensure market_data runs first and passes symbols to fact_check.
 * Reorder so market_data always comes first when both are present.
 */
export function orderToolsByDependency({
  selectedTools
}: {
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  // If both market_data and fact_check are selected, ensure market_data comes first
  if (selectedTools.includes('market_data') && selectedTools.includes('fact_check')) {
    const withoutMarketData = selectedTools.filter((tool) => tool !== 'market_data');

    // Return: market_data first, then other tools including fact_check
    return ['market_data', ...withoutMarketData.filter((tool) => tool !== 'fact_check'), 'fact_check'];
  }
  return selectedTools;
}

export function prioritizeExecutionToolsForIntent({
  message,
  selectedTools
}: {
  message: string;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  if (isExplicitFactComplianceIntent(message)) {
    return ['fact_compliance_check'];
  }

  if (isExplicitComplianceCheckIntent(message) && selectedTools.includes('compliance_check')) {
    return ['compliance_check'];
  }

  if (!isExplicitOrderExecutionIntent(message)) {
    return selectedTools;
  }

  const executionTools = selectedTools.filter(
    (tool) =>
      tool === 'create_order' ||
      tool === 'create_other_activities' ||
      tool === 'get_orders'
  );
  return executionTools.length > 0 ? executionTools : selectedTools;
}

/**
 * Detect clear portfolio or transaction retrieval patterns.
 * Used to bypass LLM reasoning for straightforward data retrieval requests.
 */
export function isClearPortfolioOrTransactionRetrieval(
  message: string,
  keywordTools: AgentToolName[]
): boolean {
  const hasPortfolioFamilyTool =
    keywordTools.includes('portfolio_analysis') || keywordTools.includes('holdings_analysis');
  const hasTransactionRetrievalTool =
    keywordTools.includes('transaction_timeline') || keywordTools.includes('transaction_categorize');

  const normalized = message.toLowerCase();
  const clearlyPortfolioRetrieval = /\b(portfolio|holdings?|allocation|balance|net worth|performance|cash)\b/.test(
    normalized
  );
  const clearlyTransactionRetrieval =
    /\b(what|when|which)\b.*\b(did i|have i)?\b.*\b(buy|bought|sell|sold)\b/.test(normalized) ||
    /\b(last year|last month|last week|this year|in 20\d{2}|during 20\d{2})\b/.test(normalized);

  if (hasPortfolioFamilyTool && clearlyPortfolioRetrieval) {
    return true;
  }
  if (hasTransactionRetrievalTool && clearlyTransactionRetrieval) {
    return true;
  }

  return false;
}

/**
 * Route price queries through fact_check chain.
 * Ensures price verification flows through market_data first, then fact_check.
 */
export function routePriceQueriesWithFactCheckChain({
  message,
  tools
}: {
  message: string;
  tools: AgentToolName[];
}): AgentToolName[] {
  if (!isPriceQuery(message)) {
    return tools;
  }

  const withoutMarketDataAndFactCheck = tools.filter(
    (tool) => tool !== 'market_data' && tool !== 'fact_check'
  );
  const hasMarketData = tools.includes('market_data');
  const hasFactCheck = tools.includes('fact_check');

  // Price flow should always be market_data first, then fact_check.
  if (hasMarketData || hasFactCheck) {
    return ['market_data', 'fact_check', ...withoutMarketDataAndFactCheck];
  }

  return tools;
}

/**
 * Detect price-related queries.
 * Used to determine if market_data/fact_check chain should be used.
 */
export function isPriceQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /\b(price|quote|current price|trading at|how much is|what is .* price)\b/.test(
      normalized
    ) || /\b[A-Z]{2,5}\b/.test(message)
  );
}
