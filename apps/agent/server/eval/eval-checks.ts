import { existsSync } from 'fs';
import { isAbsolute, resolve } from 'path';

import { createAgent } from '../agent';
import { AgentChatResponse, AgentLlm, AgentToolName } from '../types';
import {
  EvalCase,
  EvalCaseResult,
  EvalCheckResult,
  EvalDimension,
  EvalDimensionSummary,
  EvalRunOptions,
  EvalStaticDimensionInput,
  LlmTrace,
  ToolCapture,
  EMPTY_DIMENSION_SUMMARY,
  DEFAULT_MIN_PASS_RATE
} from './eval-types';
import { createEvalTools, createTrackedTools } from './eval-tools';

export async function evaluateCase({
  captures,
  durationMs,
  llm,
  llmTrace,
  options,
  response,
  testCase
}: {
  captures: ToolCapture[];
  durationMs: number;
  llm?: AgentLlm;
  llmTrace: LlmTrace;
  options: EvalRunOptions;
  response: AgentChatResponse;
  testCase: EvalCase;
}): Promise<EvalCheckResult[]> {
  const checks: EvalCheckResult[] = [];
  const comparableText = buildComparableText(response);
  const checkDoc = checkReferencedDoc(testCase);
  if (checkDoc) {
    checks.push(checkDoc);
  }

  for (const dimension of testCase.dimensions) {
    if (dimension === 'consistency') {
      checks.push(await runConsistencyCheck({ llm, options, testCase }));
      continue;
    }

    checks.push(
      ...evaluateStaticDimension({
        comparableText,
        captures,
        dimension,
        durationMs,
        llmTrace,
        response,
        testCase
      })
    );
  }

  const routeCheck = checkExpectedRoute(testCase, response);
  if (routeCheck) {
    checks.push(routeCheck);
  }

  if (testCase.expectedTools.length > 0 && testCase.expectedOutput?.length) {
    checks.push(...checkTextContains(testCase.expectedOutput, comparableText, 'expected output', 'correctness'));
  }

  return checks;
}

export function validateEvalCaseContract(testCase: EvalCase): void {
  const missing: string[] = [];
  if (typeof testCase.id !== 'string' || !testCase.id.trim()) missing.push('id');
  if (typeof testCase.query !== 'string' || !testCase.query.trim()) missing.push('query');
  if (!Array.isArray(testCase.expectedTools)) missing.push('expectedTools');
  if (testCase.expectedOutput !== undefined && !Array.isArray(testCase.expectedOutput)) {
    missing.push('expectedOutput[]');
  }
  if (!Array.isArray(testCase.passFailCriteria) || testCase.passFailCriteria.length === 0) {
    missing.push('passFailCriteria');
  }
  if (testCase.checkDoc !== undefined) {
    if (typeof testCase.checkDoc !== 'string' || testCase.checkDoc.trim().length === 0) {
      missing.push('checkDoc');
    } else if (!testCase.checkDoc.toLowerCase().endsWith('.md')) {
      missing.push('checkDoc(.md)');
    }
  }
  if (missing.length > 0) {
    throw new Error(`Eval case ${testCase.id || '<unknown>'} missing required fields: ${missing.join(', ')}`);
  }
}

export function summarizeByDimension(results: EvalCaseResult[]): Record<EvalDimension, EvalDimensionSummary> {
  const summary = {
    correctness: { ...EMPTY_DIMENSION_SUMMARY },
    tool_selection: { ...EMPTY_DIMENSION_SUMMARY },
    tool_execution: { ...EMPTY_DIMENSION_SUMMARY },
    safety: { ...EMPTY_DIMENSION_SUMMARY },
    consistency: { ...EMPTY_DIMENSION_SUMMARY },
    edge_cases: { ...EMPTY_DIMENSION_SUMMARY },
    latency: { ...EMPTY_DIMENSION_SUMMARY }
  } satisfies Record<EvalDimension, EvalDimensionSummary>;

  for (const result of results) {
    for (const check of result.checks) {
      const slot = summary[check.dimension];
      slot.total += 1;
      if (check.passed) {
        slot.passed += 1;
      } else {
        slot.failed += 1;
      }
      slot.passRate = slot.total === 0 ? 0 : slot.passed / slot.total;
    }
  }

  return summary;
}

export function passesGate({
  options,
  overallPassRate,
  perDimension
}: {
  options: EvalRunOptions;
  overallPassRate: number;
  perDimension: Record<EvalDimension, EvalDimensionSummary>;
}) {
  if (overallPassRate < (options.minOverallPassRate ?? DEFAULT_MIN_PASS_RATE)) {
    return false;
  }

  const required = options.requiredDimensionPassRate ?? {};
  for (const [dimension, minRate] of Object.entries(required)) {
    if (perDimension[dimension as EvalDimension].passRate < minRate) {
      return false;
    }
  }

  return true;
}

function evaluateStaticDimension({
  comparableText,
  captures,
  dimension,
  durationMs,
  llmTrace,
  response,
  testCase
}: EvalStaticDimensionInput): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];

  if (dimension === 'tool_selection') {
    checks.push(checkToolSelection(testCase, response));
  }

  if (dimension === 'tool_execution') {
    checks.push(...checkToolExecution(testCase, response, captures));
  }

  if (dimension === 'correctness' && testCase.expectedOutput?.length) {
    checks.push(...checkTextContains(testCase.expectedOutput, comparableText, 'ground truth', dimension));
  }

  if (dimension === 'safety' || dimension === 'edge_cases') {
    checks.push(...checkSafetyAndEdge(testCase, response, llmTrace, dimension));
  }

  if (dimension === 'latency') {
    checks.push({
      dimension,
      message: `latency observed ${durationMs}ms (informational only, not scored)`,
      passed: true
    });
  }

  return checks;
}

async function runConsistencyCheck({
  llm,
  options,
  testCase
}: {
  llm?: AgentLlm;
  options: EvalRunOptions;
  testCase: EvalCase;
}): Promise<EvalCheckResult> {
  const runs = testCase.repeatRuns ?? 2;
  const captures: ToolCapture[] = [];
  const tools = options.tools ? createTrackedTools(options.tools, captures) : createEvalTools(captures);
  const agent = createAgent({ llm, tools });
  const answers: string[] = [];
  const toolSignatures: string[] = [];

  for (let i = 0; i < runs; i++) {
    const response = await agent.chat({
      conversationId: `eval-consistency-${testCase.id}-${i}`,
      impersonationId: options.requestImpersonationId,
      message: testCase.query,
      token: options.requestToken
    });
    answers.push(response.answer.trim());
    toolSignatures.push(response.toolCalls.map((call) => call.toolName).join('>'));
  }

  const first = answers[0] ?? '';
  const allEqual = answers.every((answer) => answer === first);
  const firstSignature = toolSignatures[0] ?? '';
  const allToolSignaturesEqual =
    firstSignature.length > 0 &&
    toolSignatures.every((signature) => signature === firstSignature);
  return {
    dimension: 'consistency',
    message: allEqual
      ? `consistent across ${runs} run(s)`
      : allToolSignaturesEqual
        ? `tool-consistent across ${runs} run(s) though wording varied`
        : `inconsistent outputs across ${runs} run(s)`,
    passed: allEqual || allToolSignaturesEqual
  };
}

function checkToolSelection(testCase: EvalCase, response: AgentChatResponse): EvalCheckResult {
  const usedTools = response.toolCalls.map((call) => call.toolName);
  const expected = testCase.expectedPrimaryTool;
  if (!expected) {
    return {
      dimension: 'tool_selection',
      message: 'no primary tool expectation specified',
      passed: true
    };
  }

  return {
    dimension: 'tool_selection',
    message: `expected primary tool ${expected}, got ${usedTools[0] ?? 'none'}`,
    passed: usedTools[0] === expected
  };
}

function checkToolExecution(
  testCase: EvalCase,
  response: AgentChatResponse,
  captures: ToolCapture[]
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const successful = response.toolCalls.every((call) => call.success);
  if (testCase.requireSuccessfulToolCalls) {
    checks.push({
      dimension: 'tool_execution',
      message: 'all invoked tool calls succeeded',
      passed: successful
    });
  }

  if (testCase.expectedToolCountAtLeast !== undefined) {
    checks.push({
      dimension: 'tool_execution',
      message: `tool call count >= ${testCase.expectedToolCountAtLeast}`,
      passed: response.toolCalls.length >= testCase.expectedToolCountAtLeast
    });
  }

  if (testCase.expectedTools?.length) {
    const missing = testCase.expectedTools.filter(
      (tool) => !response.toolCalls.some((call) => call.toolName === tool)
    );
    checks.push({
      dimension: 'tool_execution',
      message:
        missing.length === 0
          ? 'all expected tools were invoked'
          : `missing expected tools: ${missing.join(', ')}`,
      passed: missing.length === 0
    });
  }

  if (testCase.requiredToolInputFields) {
    checks.push(...checkRequiredToolInputFields(testCase.requiredToolInputFields, captures));
  }

  return checks;
}

function checkRequiredToolInputFields(
  requiredFields: Partial<Record<AgentToolName, string[]>>,
  captures: ToolCapture[]
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  for (const [tool, fields] of Object.entries(requiredFields)) {
    const capture = captures.find((item) => item.tool === tool);
    if (!capture) {
      checks.push({
        dimension: 'tool_execution',
        message: `tool ${tool} capture not found`,
        passed: false
      });
      continue;
    }

    const missing = (fields ?? []).filter((field) => !(field in capture.input));
    checks.push({
      dimension: 'tool_execution',
      message:
        missing.length === 0
          ? `tool ${tool} received required input fields`
          : `tool ${tool} missing input fields: ${missing.join(', ')}`,
      passed: missing.length === 0
    });
  }

  return checks;
}

function checkSafetyAndEdge(
  testCase: EvalCase,
  response: AgentChatResponse,
  llmTrace: LlmTrace,
  dimension: 'safety' | 'edge_cases'
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const trace = response.trace ?? [];

  if (testCase.expectedValidity !== undefined) {
    checks.push({
      dimension,
      message: `verification isValid == ${testCase.expectedValidity}`,
      passed: response.verification.isValid === testCase.expectedValidity
    });
  }

  if (testCase.expectedFlags?.length) {
    const missingFlags = testCase.expectedFlags.filter(
      (flag) => !response.verification.flags.includes(flag)
    );
    checks.push({
      dimension,
      message:
        missingFlags.length === 0
          ? 'all expected verification flags present'
          : `missing verification flags: ${missingFlags.join(', ')}`,
      passed: missingFlags.length === 0
    });
  }

  checks.push(...checkTextContains(testCase.mustContain, response.answer, 'answer', dimension));
  checks.push(...checkTextNotContains(testCase.mustNotContain, response.answer, 'answer', dimension));

  if (testCase.requireLlmAnswer) {
    checks.push({
      dimension,
      message: 'llm answer path was invoked',
      passed: llmTrace.answerCalls > 0 || trace.some((step) => step.type === 'llm' && step.name === 'answer')
    });
  }

  if (testCase.requireLlmReasoning) {
    checks.push({
      dimension,
      message: 'llm reasoning path was invoked',
      passed: llmTrace.reasoningCalls > 0 || trace.some((step) => step.type === 'llm' && step.name === 'route')
    });
  }

  if (testCase.requireLlmSynthesis) {
    checks.push({
      dimension,
      message: 'synthesis path was invoked',
      passed: trace.some((step) => step.type === 'llm' && step.name === 'synthesize')
    });
  }

  return checks;
}

function checkTextContains(
  expected: string[] | undefined,
  value: string,
  label: string,
  dimension: EvalDimension
): EvalCheckResult[] {
  if (!expected?.length) {
    return [];
  }

  const lower = value.toLowerCase();
  return expected.map((fragment) => ({
    dimension,
    message: `${label} contains "${fragment}"`,
    passed: lower.includes(fragment.toLowerCase())
  }));
}

function checkTextNotContains(
  banned: string[] | undefined,
  value: string,
  label: string,
  dimension: EvalDimension
): EvalCheckResult[] {
  if (!banned?.length) {
    return [];
  }

  const lower = value.toLowerCase();
  return banned.map((fragment) => ({
    dimension,
    message: `${label} does not contain "${fragment}"`,
    passed: !lower.includes(fragment.toLowerCase())
  }));
}

function checkExpectedRoute(
  testCase: EvalCase,
  response: AgentChatResponse
): EvalCheckResult | undefined {
  if (!testCase.expectedRoute) {
    return undefined;
  }

  const trace = response.trace ?? [];
  const names = trace.map((step) => `${step.type}:${step.name}`);
  const hasRoute = names.includes('llm:route');
  const hasTool = trace.some((step) => step.type === 'tool');
  const hasLlmAfterTools = (() => {
    const firstToolIndex = trace.findIndex((step) => step.type === 'tool');
    if (firstToolIndex < 0) return false;
    return trace.slice(firstToolIndex + 1).some((step) => step.type === 'llm');
  })();
  const hasDirectAnswer = names.includes('llm:answer');
  const hasConversationOutput = response.conversation.length > 0 && response.answer.trim().length > 0;

  if (testCase.expectedRoute === 'llm_user') {
    return {
      dimension: 'edge_cases',
      message: 'route follows llm->user path',
      passed: hasRoute && !hasTool && hasDirectAnswer && hasConversationOutput
    };
  }

  return {
    dimension: 'tool_execution',
    message: 'route follows llm->tools->llm->user path',
    passed: hasRoute && hasTool && hasLlmAfterTools && hasConversationOutput
  };
}

function buildComparableText(response: AgentChatResponse): string {
  const answer = response.answer ?? '';
  const toolPayloadText = response.toolCalls
    .map((call) => {
      const result = call.result;
      if (!result || typeof result !== 'object') return '';
      const payload = result as Record<string, unknown>;
      const summary = typeof payload.summary === 'string' ? payload.summary : '';
      const toolAnswer = typeof payload.answer === 'string' ? payload.answer : '';
      return `${summary} ${toolAnswer} ${JSON.stringify(payload)}`;
    })
    .join(' ');
  return `${answer} ${toolPayloadText}`.trim();
}

function checkReferencedDoc(testCase: EvalCase): EvalCheckResult | undefined {
  if (!testCase.checkDoc) {
    return undefined;
  }

  const docPath = testCase.checkDoc.trim();
  const resolvedPath = isAbsolute(docPath) ? docPath : resolve(process.cwd(), docPath);
  const exists = existsSync(resolvedPath);

  return {
    dimension: 'correctness',
    message: `checkDoc exists: ${docPath}`,
    passed: exists
  };
}
