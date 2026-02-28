/**
 * Tool result formatters: Convert tool results into user-friendly answers.
 * Used to format compliance checks, static analysis, and order confirmations.
 */

import { AgentChatResponse } from '../types';

/**
 * Prefer direct tool answer for single order-tool calls:
 * - Clarification answers (needsClarification=true)
 * - Successful create/update order execution answers
 * This avoids LLM rephrasing that can introduce misleading confirmation text.
 */
export function getPreferredSingleToolAnswerFromToolCalls(
  toolCalls: AgentChatResponse['toolCalls']
): string | undefined {
  if (toolCalls.length !== 1 || !toolCalls[0].success) return undefined;
  const call = toolCalls[0];
  if (
    call.toolName !== 'create_order' &&
    call.toolName !== 'create_other_activities' &&
    call.toolName !== 'compliance_check' &&
    call.toolName !== 'static_analysis' &&
    call.toolName !== 'tax_estimate'
  ) {
    return undefined;
  }
  const result = call.result as Record<string, unknown>;
  if (call.toolName === 'compliance_check') {
    return buildComplianceAnswer(result);
  }
  if (call.toolName === 'static_analysis') {
    return buildStaticAnalysisAnswer(result);
  }
  const answer = typeof result.answer === 'string' ? result.answer.trim() : undefined;
  if (!answer || answer.length === 0) return undefined;
  if (result?.needsClarification === true) return answer;
  if (result?.success === true) return answer;
  return answer && answer.length > 0 ? answer : undefined;
}

export function buildComplianceAnswer(result: Record<string, unknown>): string | undefined {
  const violations = normalizeComplianceItems(result.violations);
  const warnings = normalizeComplianceItems(result.warnings);

  if (violations.length > 0) {
    return [
      `I ran a compliance check and found ${violations.length} blocking violation(s), so you should not proceed yet.`,
      `Violations: ${violations.join(' | ')}`,
      warnings.length > 0 ? `Warnings: ${warnings.join(' | ')}` : '',
      'Next step: Resolve the blocking violations before executing this trade.'
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  }

  if (warnings.length > 0) {
    return [
      `I ran a compliance check and found no blocking violations, but ${warnings.length} warning(s).`,
      `Warnings: ${warnings.join(' | ')}`,
      'Next step: Review the warnings before executing this trade.'
    ].join('\n');
  }

  return 'I ran a compliance check and found no blocking violations or warnings.';
}

export function buildStaticAnalysisAnswer(result: Record<string, unknown>): string | undefined {
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  const risks = Array.isArray(result.risks) ? result.risks : [];
  if (result.success === false) {
    const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
    return answer || summary || 'Could not fetch portfolio report.';
  }
  if (risks.length === 0) {
    return summary || 'Portfolio report: all checked rules are fulfilled; no potential risks identified.';
  }
  const lines: string[] = [summary];
  const maxRisks = 8;
  for (let i = 0; i < Math.min(risks.length, maxRisks); i++) {
    const r = risks[i] as Record<string, unknown> | undefined;
    if (!r || typeof r !== 'object') continue;
    const cat = typeof r.categoryName === 'string' ? r.categoryName : '';
    const name = typeof r.ruleName === 'string' ? r.ruleName : '';
    const eval_ = typeof r.evaluation === 'string' ? r.evaluation : '';
    if (cat || name || eval_) {
      lines.push(`• ${cat}${cat && name ? ' – ' : ''}${name}${(cat || name) && eval_ ? ': ' : ''}${eval_}`);
    }
  }
  if (risks.length > maxRisks) {
    lines.push(`… and ${risks.length - maxRisks} more potential risk(s).`);
  }
  return lines.join('\n');
}

export function normalizeComplianceItems(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const ruleId = typeof record.rule_id === 'string' ? record.rule_id : 'UNKNOWN_RULE';
      const message =
        typeof record.message === 'string' && record.message.trim().length > 0
          ? record.message.trim()
          : 'No details provided.';
      return `${ruleId}: ${message}`;
    })
    .filter((value): value is string => Boolean(value));
}
