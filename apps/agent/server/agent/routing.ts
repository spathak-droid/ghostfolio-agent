import type { AgentToolName, CreateOrderParams } from '../types';
import type { AgentWorkflowState } from '../stores';
import { SELECTABLE_TOOL_NAMES } from '../tools/tool-registry';
import { SELECTABLE_KEYWORD_HINTS } from './routing-keywords';

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

function isExplicitFactComplianceIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const hasFactIntent =
    /\bfact check\b/.test(normalized) ||
    /\bfact-check\b/.test(normalized) ||
    /\bverify\b/.test(normalized) ||
    /\bdouble check\b/.test(normalized) ||
    /\bdouble-check\b/.test(normalized) ||
    /\bcross-check\b/.test(normalized) ||
    /\bconfirm price\b/.test(normalized);
  const hasComplianceIntent =
    /\bcompliance\b/.test(normalized) ||
    /\bcompliance check\b/.test(normalized) ||
    /\bcheck .*compliance\b/.test(normalized) ||
    /\bcompliant\b/.test(normalized) ||
    /\bregulation\b/.test(normalized) ||
    /\bpolicy check\b/.test(normalized) ||
    /\bis this compliant\b/.test(normalized);

  return hasFactIntent && hasComplianceIntent;
}

function isExplicitComplianceCheckIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    /\bcompliance check\b/.test(normalized) ||
    /\bcheck .*compliance\b/.test(normalized) ||
    /\bcheck .*regulation\b/.test(normalized) ||
    /\bregulatory check\b/.test(normalized) ||
    /\bpolicy check\b/.test(normalized) ||
    /\bis this compliant\b/.test(normalized)
  );
}

export function messageMatchesRetrievalPatterns(message: string): boolean {
  const normalized = message.toLowerCase();
  if (/\b(20\d{2})\b/.test(message)) return true;
  if (/\b(last week|last month|last year|ytd|today|yesterday)\b/.test(normalized)) return true;
  if (/\b(price|quote|cost|return|performance)\b/.test(normalized)) return true;
  if (/\b[A-Z]{1,5}\b/.test(message)) return true;
  if (/\b(btc|bitcoin|eth|ethereum)\b/.test(normalized)) return true;
  return false;
}

export function isExplicitOrderExecutionIntent(message: string): boolean {
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

function isSmallTalk(message: string) {
  const normalized = message.trim().toLowerCase();
  return [
    'hello',
    'hi',
    'hey',
    'yo',
    'sup',
    'thanks',
    'thank you',
    'good morning',
    'good afternoon',
    'good evening',
    'how are you'
  ].includes(normalized);
}

export function classifyIntent(message: string): 'finance' | 'general' {
  if (isSmallTalk(message)) {
    return 'general';
  }

  return hasFinanceEntityOrAction(message) ? 'finance' : 'general';
}

function hasFinanceEntityOrAction(message: string) {
  const normalized = message.toLowerCase();
  if (
    /\b(add|record|create|buy|sell)\b.*\b(order|activity|dividend|divident|fee|interest|liability|liabilty|liablity|mortgage|loan|debt)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  const financeKeywords = [
    'portfolio',
    'allocation',
    'market',
    'price',
    'stock',
    'crypto',
    'bitcoin',
    'btc',
    'tsla',
    'tesla',
    'aapl',
    'nvda',
    'transaction',
    'buy',
    'sell',
    'dividend',
    'divident',
    'fee',
    'holding',
    'holdings',
    'p&l',
    'performance',
    'return',
    'invest',
    'tax',
    'taxes',
    'capital gains',
    'dividend',
    'coin',
    'compliance',
    'regulation',
    'balance',
    'account',
    'cash',
    'interest',
    'liability',
    'liabilty',
    'liablity',
    'mortgage',
    'loan',
    'debt',
    'ticker'
  ];

  return financeKeywords.some((keyword) => normalized.includes(keyword));
}

export function mergeCreateOrderParams(
  ...candidates: (CreateOrderParams | Partial<CreateOrderParams> | undefined)[]
): CreateOrderParams | undefined {
  const merged = Object.assign({}, ...candidates.filter(Boolean)) as CreateOrderParams;
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function inferCreateOrderParamsFromMessage(
  message: string
): Partial<CreateOrderParams> | undefined {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const inferred: Partial<CreateOrderParams> = {};
  if (/\b(dividend|divident)\b/.test(normalized)) {
    inferred.type = 'DIVIDEND';
  } else if (/\b(fee|charges?)\b/.test(normalized)) {
    inferred.type = 'FEE';
  } else if (/\b(interest)\b/.test(normalized)) {
    inferred.type = 'INTEREST';
  } else if (/\b(liability|liabilty|liablity|mortgage|loan|debt)\b/.test(normalized)) {
    inferred.type = 'LIABILITY';
  } else if (/\b(sell|sold)\b/.test(normalized)) {
    inferred.type = 'SELL';
  } else if (/\b(buy|purchase|long)\b/.test(normalized)) {
    inferred.type = 'BUY';
  }

  if (/\bsolana\b|\bsol-usd\b|\bsolusd\b|\bsol\b/.test(normalized)) {
    inferred.symbol = 'SOL-USD';
  } else if (/\bbitcoin\b|\bbtc-usd\b|\bbtcusd\b|\bbtc\b/.test(normalized)) {
    inferred.symbol = 'BTC-USD';
  } else if (/\bethereum\b|\beth-usd\b|\bethusd\b|\beth\b/.test(normalized)) {
    inferred.symbol = 'ETH-USD';
  } else if (/\bapple\b|\baapl\b/.test(normalized)) {
    inferred.symbol = 'AAPL';
  } else if (/\btesla\b|\btsla\b/.test(normalized)) {
    inferred.symbol = 'TSLA';
  } else if (/\b(mortgage)\b/.test(normalized)) {
    inferred.symbol = 'MORTGAGE';
  } else if (/\b(loan)\b/.test(normalized)) {
    inferred.symbol = 'LOAN';
  } else if (/\b(debt)\b/.test(normalized)) {
    inferred.symbol = 'DEBT';
  }

  const amountRegex = /\b(?:amount\s*(?:to)?|of)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/;
  const amountMatch = amountRegex.exec(normalized);
  if (amountMatch?.[1] && inferred.unitPrice === undefined) {
    const parsed = Number(amountMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      inferred.unitPrice = parsed;
    }
  }

  const quantityRegex = /\b(?:buy|sell)(?:\s+me)?\s+([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/;
  const quantityMatch = quantityRegex.exec(normalized);
  if (quantityMatch?.[1]) {
    const parsed = Number(quantityMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      inferred.quantity = parsed;
    }
  }

  return Object.keys(inferred).length > 0 ? inferred : undefined;
}

export function ensurePendingClarificationTool({
  message,
  pendingState,
  selectedTools
}: {
  message: string;
  pendingState?: AgentWorkflowState;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  if (
    pendingState?.pendingAction !== 'awaiting_clarification' ||
    !pendingState.pendingTool ||
    (pendingState.pendingTool !== 'create_order' &&
      pendingState.pendingTool !== 'create_other_activities' &&
      pendingState.pendingTool !== 'get_orders')
  ) {
    return selectedTools;
  }

  // LLM already selected a non-order tool for this turn: do not hijack with pending order flow.
  if (
    selectedTools.some(
      (tool) =>
        tool !== 'create_order' && tool !== 'create_other_activities' && tool !== 'get_orders'
    )
  ) {
    return selectedTools;
  }

  const normalized = message.trim().toLowerCase();
  const cancelIntent =
    /\b(cancel|stop|nevermind|never mind|forget it|don'?t place)\b/.test(normalized);
  if (cancelIntent) {
    return selectedTools;
  }
  if (isHistoricalTransactionLookupIntent(normalized)) {
    return selectedTools;
  }

  if (isOrderConfirmationMessage(message)) {
    if (selectedTools.includes(pendingState.pendingTool)) {
      return selectedTools;
    }
    return [pendingState.pendingTool, ...selectedTools];
  }

  if (!looksLikeOrderClarificationInput(normalized)) {
    return selectedTools;
  }

  if (selectedTools.includes(pendingState.pendingTool)) {
    return selectedTools;
  }

  return [pendingState.pendingTool, ...selectedTools];
}

export function preventOrderReplayWithoutPending({
  message,
  pendingState,
  selectedTools
}: {
  message: string;
  pendingState?: AgentWorkflowState;
  selectedTools: AgentToolName[];
}): AgentToolName[] {
  if (hasPendingOrderClarification(pendingState)) {
    return selectedTools;
  }

  if (!isOrderConfirmationMessage(message)) {
    return selectedTools;
  }

  if (isExplicitOrderExecutionIntent(message)) {
    return selectedTools;
  }

  return selectedTools.filter(
    (tool) => tool !== 'create_order' && tool !== 'create_other_activities'
  );
}

export function sanitizeOrderToolsForNonOrderRequests({
  message,
  pendingState,
  selectedTools
}: {
  message: string;
  pendingState?: AgentWorkflowState;
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

export function hasPendingOrderClarification(pendingState?: AgentWorkflowState): boolean {
  return (
    pendingState?.pendingAction === 'awaiting_clarification' &&
    (pendingState.pendingTool === 'create_order' ||
      pendingState.pendingTool === 'create_other_activities' ||
      pendingState.pendingTool === 'get_orders')
  );
}

export function isOrderConfirmationMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return /^(yes|yes proceed|proceed|confirm|confirmed|go ahead|do it|place it|submit it)\b/.test(
    normalized
  );
}

function looksLikeOrderClarificationInput(normalizedMessage: string): boolean {
  if (!normalizedMessage) return false;
  if (isHistoricalTransactionLookupIntent(normalizedMessage)) {
    return false;
  }
  const compact = normalizedMessage.replace(/\s+/g, '');

  if (
    /\b(buy|sell|purchase|long|short|quantity|qty|shares?|units?|price|amount|currency|usd|eur|gbp|account|date|today|tomorrow|yesterday|due|dividend|divident|fee|interest|liability|liabilty|liablity|mortgage|loan)\b/.test(
      normalizedMessage
    )
  ) {
    return true;
  }

  if (/\b(solana|bitcoin|ethereum|aapl|tsla|nvda|btc|eth|sol)\b/.test(normalizedMessage)) {
    return true;
  }

  if (/\b[a-z]{2,10}-[a-z]{2,10}\b/.test(normalizedMessage)) {
    return true;
  }

  if (/^[a-z0-9.-]{2,15}$/.test(compact) && /(usd|eur|gbp|btc|eth)$/.test(compact)) {
    return true;
  }

  if (/^\s*[0-9][0-9,.\s]*\s*$/.test(normalizedMessage)) {
    return true;
  }

  if (/\b(acc[-_ ]?[a-z0-9]+|account[-_ ]?[a-z0-9]+)\b/.test(normalizedMessage)) {
    return true;
  }

  return false;
}

function isHistoricalTransactionLookupIntent(normalizedMessage: string): boolean {
  if (!normalizedMessage.includes('buy') && !normalizedMessage.includes('bought') && !normalizedMessage.includes('sell') && !normalizedMessage.includes('sold')) {
    return false;
  }

  const asksHistory =
    /\b(last week|last month|last year|yesterday|today|this year|in 20\d{2}|during 20\d{2}|over time|history|historical|previous)\b/.test(
      normalizedMessage
    ) ||
    /\b(what|when|which|show|list)\b.*\b(did i|have i)?\b.*\b(buy|bought|sell|sold)\b/.test(
      normalizedMessage
    ) ||
    /\b(did i|have i)\b.*\b(buy|bought|sell|sold)\b/.test(normalizedMessage);

  if (!asksHistory) {
    return false;
  }

  return !isExplicitOrderExecutionIntent(normalizedMessage);
}
