/**
 * Tool scope sanitizers: Filter tools based on message context and intent.
 * Ensures tools are only used when appropriate for the user's query.
 */

import type { AgentToolName } from '../../types';

export function sanitizeOrderToolsForNonOrderRequests({
  message,
  pendingState,
  selectedTools
}: {
  message: string;
  pendingState?: any;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  if (hasPendingOrderClarification(pendingState)) {
    return selectedTools;
  }

  if (isExplicitOrderExecutionIntent(message)) {
    return selectedTools;
  }

  return selectedTools.filter(
    (tool) => tool !== 'create_order' && tool !== 'create_other_activities'
  );
}

export function sanitizeAnalyzeStockTrendForScope({
  message,
  selectedTools
}: {
  message: string;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  if (!selectedTools.includes('analyze_stock_trend')) {
    return selectedTools;
  }

  const normalized = message.toLowerCase();
  const asksPortfolioWide =
    /\b(all|overall|entire)\b.*\b(holding|holdings|portfolio)\b/.test(normalized) ||
    /\bhow are all my holdings\b/.test(normalized) ||
    /\bhow are my holdings\b/.test(normalized) ||
    /\bany risk\b/.test(normalized);

  if (asksPortfolioWide) {
    return selectedTools.filter((tool) => tool !== 'analyze_stock_trend');
  }

  if (!hasSpecificAssetReference(message)) {
    return selectedTools.filter((tool) => tool !== 'analyze_stock_trend');
  }

  return selectedTools;
}

export function sanitizePortfolioHoldingsToolScope({
  message,
  selectedTools
}: {
  message: string;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  const hasPortfolioTool = selectedTools.includes('portfolio_analysis');
  const hasHoldingsTool = selectedTools.includes('holdings_analysis');
  if (!hasPortfolioTool && !hasHoldingsTool) {
    return selectedTools;
  }

  const normalized = message.toLowerCase();
  const mentionsAllocation = /\ballocation\b/.test(normalized);
  const mentionsHoldings = /\bholding(s)?\b/.test(normalized);
  const mentionsPortfolio = /\bportfolio\b/.test(normalized);

  // Keep both tools when users ask portfolio + allocation together.
  if (mentionsPortfolio && mentionsAllocation) {
    return selectedTools;
  }

  if (mentionsHoldings) {
    return selectedTools.filter((tool) => tool !== 'portfolio_analysis');
  }

  if (mentionsPortfolio) {
    return selectedTools.filter((tool) => tool !== 'holdings_analysis');
  }

  return selectedTools;
}

export function enforceHoldingsAnalysisForAssetQuestions({
  message,
  selectedTools
}: {
  message: string;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  const normalized = message.toLowerCase();
  const asksHoldingTerms =
    /\b(coin|stock|holding|holdings|position|asset)\b/.test(normalized) ||
    /\b(top|best|worst)\s+perform(ing|er)s?\b/.test(normalized);
  if (!asksHoldingTerms) {
    return selectedTools;
  }

  const withoutTrend = selectedTools.filter((tool) => tool !== 'analyze_stock_trend');
  if (withoutTrend.includes('holdings_analysis')) {
    return withoutTrend;
  }
  return ['holdings_analysis', ...withoutTrend];
}

function hasSpecificAssetReference(message: string): boolean {
  const normalized = message.toLowerCase();
  if (/\b[A-Z]{2,5}(?:-[A-Z]{2,5})?\b/.test(message)) return true;
  if (/\b[a-z]{2,10}-[a-z]{2,10}\b/.test(normalized)) return true;
  return /\b(bitcoin|btc|ethereum|eth|solana|sol|tesla|tsla|apple|aapl|nvidia|nvda)\b/.test(
    normalized
  );
}

function hasPendingOrderClarification(pendingState?: any): boolean {
  return (
    pendingState?.pendingAction === 'awaiting_clarification' &&
    (pendingState.pendingTool === 'create_order' ||
      pendingState.pendingTool === 'create_other_activities' ||
      pendingState.pendingTool === 'get_orders')
  );
}

function isExplicitOrderExecutionIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  const advisoryPatterns = [
    /\bshould i\s+(buy|sell)\b/,
    /\b(do you think|would you)\b.*\b(buy|sell)\b/,
    /\bis it (a )?good (idea )?to\s+(buy|sell)\b/,
    /\bbuy or sell\b/,
    /\bcan i\s+(buy|sell)\b/
  ];
  if (advisoryPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (/^(buy|sell)\b/.test(normalized)) {
    return !normalized.includes('?');
  }

  return [
    /\bcan you\s+(buy|sell)\b/,
    /\b(i want to|i'd like to|please)\s+(buy|sell)\b/,
    /\b(add|record)\s+(a\s+)?(buy|sell)\b/,
    /\b(add|record)\s+(a\s+)?(dividend|divident|fee|interest|liability|liabilty|liablity|mortgage|loan|debt)\b/,
    /\b(buy)\s+(a\s+)?(liability|liabilty|liablity)\b/,
    /\b(place|execute|submit|create|update)\s+(an?\s+)?order\b/,
    /\b(add|record)\s+(an?\s+)?activity\b/,
    /\b(buy|sell)\s+\d+(\.\d+)?\s+[a-z0-9.-]+\b/
  ].some((pattern) => pattern.test(normalized));
}
