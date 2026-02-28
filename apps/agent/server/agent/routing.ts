/**
 * Routing barrel: Re-exports all routing functions from focused sub-modules.
 * Each module handles a specific aspect of tool routing and selection.
 */

export {
  classifyIntent,
  isExplicitComplianceCheckIntent,
  isExplicitOrderExecutionIntent,
  messageMatchesRetrievalPatterns
} from './routing/intent-classifiers';

export {
  inferCreateOrderParamsFromMessage,
  mergeCreateOrderParams
} from './routing/order-params';

export {
  enforceHoldingsAnalysisForAssetQuestions,
  sanitizeAnalyzeStockTrendForScope,
  sanitizeOrderToolsForNonOrderRequests,
  sanitizePortfolioHoldingsToolScope
} from './routing/tool-scope-sanitizers';

export {
  ensurePendingClarificationTool,
  hasPendingOrderClarification,
  isOrderConfirmationMessage,
  preventOrderReplayWithoutPending
} from './routing/pending-state-guards';

export {
  isClearPortfolioOrTransactionRetrieval,
  isPriceQuery,
  normalizeOrderToolsForIntent,
  orderToolsByDependency,
  preventComplianceBlockingSpecializedTools,
  prioritizeExecutionToolsForIntent,
  removeOrderTools,
  routePriceQueriesWithFactCheckChain,
  selectToolsByKeyword
} from './routing/tool-selectors';
