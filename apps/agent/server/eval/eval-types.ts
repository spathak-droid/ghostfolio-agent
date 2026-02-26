import {
  AgentChatResponse,
  AgentLlm,
  AgentToolName,
  AgentTools
} from '../types';

export type EvalDimension =
  | 'correctness'
  | 'tool_selection'
  | 'tool_execution'
  | 'safety'
  | 'consistency'
  | 'edge_cases'
  | 'latency';

export type EvalDifficulty = 'happy' | 'edge' | 'adversarial' | 'multi';

export interface EvalCase {
  id: string;
  difficulty: EvalDifficulty;
  query: string;
  expectedTools: AgentToolName[];
  expectedOutput?: string[];
  passFailCriteria: string[];
  dimensions: EvalDimension[];
  mustContain: string[];
  mustNotContain: string[];
  expectedToolCountAtLeast?: number;
  expectedFlags?: string[];
  expectedPrimaryTool?: AgentToolName;
  expectedValidity?: boolean;
  latencyMsMax?: number;
  requiredToolInputFields?: Partial<Record<AgentToolName, string[]>>;
  requireSuccessfulToolCalls?: boolean;
  repeatRuns?: number;
  requireLlmAnswer?: boolean;
  requireLlmReasoning?: boolean;
  requireLlmSynthesis?: boolean;
  expectedRoute?: 'llm_tools_llm_user' | 'llm_user';
  checkDoc?: string;
  note?: string;
}

export interface EvalCheckResult {
  dimension: EvalDimension;
  message: string;
  passed: boolean;
}

export interface EvalCaseResult {
  caseId: string;
  checks: EvalCheckResult[];
  durationMs: number;
  passed: boolean;
}

export interface EvalDimensionSummary {
  failed: number;
  passed: number;
  passRate: number;
  total: number;
}

export interface EvalSummary {
  failed: number;
  gatePassed: boolean;
  overallPassRate: number;
  passed: number;
  perDimension: Record<EvalDimension, EvalDimensionSummary>;
  results: EvalCaseResult[];
  total: number;
}

export interface EvalRunOptions {
  llm?: AgentLlm;
  minOverallPassRate?: number;
  requestImpersonationId?: string;
  requestToken?: string;
  requiredDimensionPassRate?: Partial<Record<EvalDimension, number>>;
  suppressNonEvalLogs?: boolean;
  tools?: AgentTools;
  useFixtureLlm?: boolean;
  verbose?: boolean;
}

export interface ToolCapture {
  input: Record<string, unknown>;
  tool: AgentToolName;
}

export interface LlmTrace {
  answerCalls: number;
  reasoningCalls: number;
  synthesisCalls: number;
}

export const DEFAULT_MIN_PASS_RATE = 0.9;

export const EMPTY_DIMENSION_SUMMARY: EvalDimensionSummary = {
  failed: 0,
  passed: 0,
  passRate: 0,
  total: 0
};

export interface EvalStaticDimensionInput {
  comparableText: string;
  captures: ToolCapture[];
  dimension: Exclude<EvalDimension, 'consistency'>;
  durationMs: number;
  llmTrace: LlmTrace;
  response: AgentChatResponse;
  testCase: EvalCase;
}
