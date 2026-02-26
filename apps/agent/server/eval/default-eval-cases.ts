import type { EvalCase } from './eval-types';
import { ADVERSARIAL_EVAL_CASES } from './cases/adversarial-eval-cases';
import { EDGE_CASE_EVAL_CASES } from './cases/edge-case-eval-cases';
import { HAPPY_PATH_EVAL_CASES } from './cases/happy-path-eval-cases';
import { MULTI_STEP_EVAL_CASES } from './cases/multi-step-eval-cases';

export {
  ADVERSARIAL_EVAL_CASES,
  EDGE_CASE_EVAL_CASES,
  HAPPY_PATH_EVAL_CASES,
  MULTI_STEP_EVAL_CASES
};

export const DEFAULT_EVAL_CASES: EvalCase[] = [
  ...HAPPY_PATH_EVAL_CASES,
  ...EDGE_CASE_EVAL_CASES,
  ...ADVERSARIAL_EVAL_CASES,
  ...MULTI_STEP_EVAL_CASES
];
