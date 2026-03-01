/**
 * Tool Registry
 *
 * Single source of truth for agent tools: schemas, descriptions, and error model.
 * Descriptions are written for LLM tool selection (reasonAboutQuery, selectTool).
 * Output schemas align with Ghostfolio API responses; see docs/agent/ghostfolio-api-response-schemas.md.
 *
 * Used by:
 * - llm/openai-client.ts: getSelectableToolDefinitions(), formatToolsForLlm(), SELECTABLE_TOOL_NAMES (LLM prompts + parse)
 * - agent.ts: isTransactionDependentTool(), SELECTABLE_TOOL_NAMES, TRANSACTION_DEPENDENT_TOOL_NAMES (routing + keyword fallback)
 * - synthesis/tool-result-synthesizer.ts: getToolDefinition() (prefer tool answer/summary per output_schema)
 * - eval-runner.ts: SELECTABLE_TOOL_NAMES (EvalCase.expectedTool type)
 *
 * Execution is wired in index.ts; this file is metadata only.
 * Failure modes: unknown tool name → no executor; schema violations are not enforced at runtime.
 *
 * Types and shared schemas: tool-registry-types.ts
 * Tool definitions array: tool-registry-definitions.ts
 */

import type { AgentToolName } from '../types';
import type { ToolDefinition } from './tool-registry-types';
import { TOOL_DEFINITIONS } from './tool-registry-definitions';

export type { ToolDefinition, ToolErrorModel, ToolInputSchema, ToolOutputSchema } from './tool-registry-types';
export { COMMON_INPUT, TRANSACTION_INPUT, TOOL_ERROR } from './tool-registry-types';

export { TOOL_DEFINITIONS };

export type RegisteredToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

/** Tool names the LLM can select (get_transactions is internal). */
export const SELECTABLE_TOOL_NAMES: readonly AgentToolName[] = [
  'compliance_check',
  'fact_compliance_check',
  'fact_check',
  'tax_estimate',
  'portfolio_summary',
  'portfolio_analysis',
  'holdings_analysis',
  'static_analysis',
  'market_data',
  'analyze_stock_trend',
  'market_data_lookup',
  'market_overview',
  'transaction_categorize',
  'transaction_timeline',
  'create_order',
  'create_other_activities',
  'get_orders'
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
