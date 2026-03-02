import type { EvalCase } from './eval-types';
import { ADVERSARIAL_EVAL_CASES } from './cases/adversarial-eval-cases';
import { EDGE_CASE_EVAL_CASES } from './cases/edge-case-eval-cases';
import { HAPPY_PATH_EVAL_CASES } from './cases/happy-path-eval-cases';
import { MULTI_STEP_EVAL_CASES } from './cases/multi-step-eval-cases';
import { REAL_LLM_EVAL_CASES } from './cases/real-llm-eval-cases';
import { PERFORMANCE_EVAL_CASES } from './cases/performance-eval-cases';

export {
  ADVERSARIAL_EVAL_CASES,
  EDGE_CASE_EVAL_CASES,
  HAPPY_PATH_EVAL_CASES,
  MULTI_STEP_EVAL_CASES,
  REAL_LLM_EVAL_CASES,
  PERFORMANCE_EVAL_CASES
};

export const DEFAULT_EVAL_CASES: EvalCase[] = [
  ...HAPPY_PATH_EVAL_CASES,
  ...EDGE_CASE_EVAL_CASES,
  ...ADVERSARIAL_EVAL_CASES,
  ...MULTI_STEP_EVAL_CASES
];

/**
 * Extended eval suite: includes real LLM and performance cases
 * Run with: npm run eval:agent -- --include-extended
 */
export const EXTENDED_EVAL_CASES: EvalCase[] = [
  ...DEFAULT_EVAL_CASES,
  ...REAL_LLM_EVAL_CASES,
  ...PERFORMANCE_EVAL_CASES
];

/**
 * Real LLM focused cases (requires OPENAI_API_KEY or OPENROUTER_API_KEY)
 * Run with: npm run eval:agent:llm
 */
export const REAL_LLM_SUITE: EvalCase[] = REAL_LLM_EVAL_CASES;

/**
 * Performance baseline cases
 * Run with: npm run eval:agent:perf
 */
export const PERFORMANCE_SUITE: EvalCase[] = PERFORMANCE_EVAL_CASES;
