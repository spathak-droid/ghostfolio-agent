/**
 * Pending state guards: Handle tool selection when awaiting user clarification.
 * Detects clarification responses and manages the order creation flow.
 */

import type { AgentToolName } from '../../types';
import type { AgentWorkflowState } from '../../stores';

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
