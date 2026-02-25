import { createAgent } from '../agent';
import {
  AgentChatResponse,
  AgentLlm,
  AgentToolInput,
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

export interface EvalCaseExpectation {
  expectedToolCountAtLeast?: number;
  expectedTools?: AgentToolName[];
  expectedFlags?: string[];
  expectedPrimaryTool?: AgentToolName;
  expectedValidity?: boolean;
  groundTruthContains?: string[];
  latencyMsMax?: number;
  mustContain?: string[];
  mustNotContain?: string[];
  requiredToolInputFields?: Partial<Record<AgentToolName, string[]>>;
  requireSuccessfulToolCalls?: boolean;
  repeatRuns?: number;
  requireLlmAnswer?: boolean;
  requireLlmReasoning?: boolean;
  requireLlmSynthesis?: boolean;
  expectedRoute?: 'llm_tools_llm_user' | 'llm_user';
}

export interface EvalCase {
  id: string;
  inputQuery: string;
  expectedToolCalls: AgentToolName[];
  expectedOutput: string[];
  passFailCriteria: string[];
  dimensions: EvalDimension[];
  expectation: EvalCaseExpectation;
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

interface ToolCapture {
  input: AgentToolInput;
  tool: AgentToolName;
}

interface LlmTrace {
  answerCalls: number;
  reasoningCalls: number;
  synthesisCalls: number;
}

const DEFAULT_MIN_PASS_RATE = 0.9;
const EMPTY_DIMENSION_SUMMARY: EvalDimensionSummary = {
  failed: 0,
  passed: 0,
  passRate: 0,
  total: 0
};

export async function runEvalCases(
  cases: EvalCase[],
  options: EvalRunOptions = {}
): Promise<EvalSummary> {
  return withEvalLogFilter(
    async () => {
      const captures: ToolCapture[] = [];
      const llmTrace: LlmTrace = {
        answerCalls: 0,
        reasoningCalls: 0,
        synthesisCalls: 0
      };
      const llm =
        options.llm ?? (options.useFixtureLlm === false ? undefined : createEvalLlm(llmTrace));
      const verbose = options.verbose ?? false;
      const tools = options.tools ? createTrackedTools(options.tools, captures) : createEvalTools(captures);
      const agent = createAgent({
        llm,
        tools
      });

      const results: EvalCaseResult[] = [];
      for (const testCase of cases) {
        validateEvalCaseContract(testCase);
        const started = Date.now();
        const response = await agent.chat({
          conversationId: `eval-${testCase.id}`,
          impersonationId: options.requestImpersonationId,
          message: testCase.inputQuery,
          token: options.requestToken
        });
        const durationMs = Date.now() - started;
        const caseCaptures = captures.splice(0, captures.length);
        const checks = await evaluateCase({
          captures: caseCaptures,
          durationMs,
          llm,
          llmTrace: { ...llmTrace },
          options,
          response,
          testCase
        });
        llmTrace.answerCalls = 0;
        llmTrace.reasoningCalls = 0;
        llmTrace.synthesisCalls = 0;
        results.push({
          caseId: testCase.id,
          checks,
          durationMs,
          passed: checks.every((check) => check.passed)
        });

        if (verbose) {
          const last = results[results.length - 1];
          if (!last) {
            continue;
          }

          const status = last.passed ? 'PASS' : 'FAIL';
          const expectedTools = testCase.expectedToolCalls.length
            ? testCase.expectedToolCalls.join(',')
            : 'none';
          const expectedOutput = testCase.expectedOutput.join(' | ');
          const colorStatus = colorizeStatus(status, last.passed);
          console.log(`[eval] CASE id=${testCase.id}`);
          console.log(`[eval]   input=${JSON.stringify(testCase.inputQuery)}`);
          console.log(`[eval]   expected_tool_calls=${expectedTools}`);
          console.log(`[eval]   expected_output=${JSON.stringify(expectedOutput)}`);
          console.log(`[eval]   criteria=${JSON.stringify(testCase.passFailCriteria.join(' | '))}`);
          console.log(`[eval] ${colorStatus} case=${last.caseId} duration_ms=${last.durationMs}`);
          console.log(`[eval]   latency_ms=${last.durationMs} (informational, not scored)`);
          console.log('[eval] --------------');

          for (const check of last.checks) {
            const checkStatus = check.passed ? 'PASS' : 'FAIL';
            console.log(
              `[eval]   ${colorizeStatus(checkStatus, check.passed)} [${check.dimension}] ${check.message}`
            );
            console.log('[eval] --------------');
          }
        }
      }

      const passed = results.filter((result) => result.passed).length;
      const total = results.length;
      const overallPassRate = total === 0 ? 0 : passed / total;
      const perDimension = summarizeByDimension(results);
      const gatePassed = passesGate({ options, overallPassRate, perDimension });

      return {
        failed: total - passed,
        gatePassed,
        overallPassRate,
        passed,
        perDimension,
        results,
        total
      };
    },
    { suppressNonEvalLogs: options.suppressNonEvalLogs ?? true }
  );
}

function createEvalTools(captures: ToolCapture[]): AgentTools {
  const track = (tool: AgentToolName, inputOrRun: AgentToolInput, input?: AgentToolInput) => {
    const value = resolveInput(inputOrRun, input);
    captures.push({ input: value, tool });
    return value;
  };

  return {
    createOrder: async (inputOrRun, input) => {
      const resolved = track('create_order', inputOrRun, input);
      const qty = resolved.createOrderParams?.quantity;
      if (qty === undefined) {
        return buildResult({
          answer: 'How many shares do you want to buy?',
          needsClarification: true,
          summary: 'Quantity required'
        });
      }

      return buildResult({
        answer: `Created BUY order for ${qty} shares.`,
        needsClarification: false,
        summary: 'Order created'
      });
    },
    getTransactions: async (inputOrRun, input) => {
      track('get_transactions', inputOrRun, input);
      return buildResult({
        data: {
          activities: [
            {
              SymbolProfile: { name: 'Tesla, Inc.', symbol: 'TSLA' },
              date: '2026-02-01T06:00:00.000Z',
              quantity: 2,
              type: 'BUY',
              unitPrice: 399.83
            }
          ]
        },
        summary: 'Fetched 1 transactions from Ghostfolio',
        transactions: [
          {
            SymbolProfile: { name: 'Tesla, Inc.', symbol: 'TSLA' },
            date: '2026-02-01T06:00:00.000Z',
            quantity: 2,
            type: 'BUY',
            unitPrice: 399.83
          }
        ]
      });
    },
    marketData: async (inputOrRun, input) => {
      track('market_data', inputOrRun, input);
      return buildResult({
        summary: 'Market data returned for requested symbols',
        symbols: [{ currentPrice: 123.45, symbol: 'BTCUSD' }]
      });
    },
    marketDataLookup: async (inputOrRun, input) => {
      track('market_data_lookup', inputOrRun, input);
      return buildResult({
        prices: [{ symbol: 'AAPL', value: 210.12 }],
        summary: 'Market data lookup from Ghostfolio API'
      });
    },
    marketOverview: async (inputOrRun, input) => {
      track('market_overview', inputOrRun, input);
      return buildResult({
        answer: 'Market sentiment snapshot: stocks are greed (66); crypto is fear (38).',
        overview: {
          cryptocurrencies: { label: 'fear', value: 38 },
          stocks: { label: 'greed', value: 66 }
        },
        summary: 'Market overview from Ghostfolio fear & greed index'
      });
    },
    portfolioAnalysis: async (inputOrRun, input) => {
      track('portfolio_analysis', inputOrRun, input);
      return buildResult({
        allocation: [{ percentage: 60, symbol: 'AAPL' }],
        summary: 'Portfolio analysis from Ghostfolio data'
      });
    },
    transactionCategorize: async (inputOrRun, input) => {
      const resolved = track('transaction_categorize', inputOrRun, input);
      return buildResult({
        categories: [{ category: 'BUY', count: (resolved.transactions ?? []).length }],
        summary: 'Transaction categorization completed'
      });
    },
    transactionTimeline: async (inputOrRun, input) => {
      const resolved = track('transaction_timeline', inputOrRun, input);
      const match = resolved.transactions?.[0] as
        | { SymbolProfile?: { symbol?: string }; date?: string; type?: string; unitPrice?: number }
        | undefined;
      return buildResult({
        summary: 'Found 1 matching transactions',
        timeline: [
          {
            date: match?.date?.slice(0, 10) ?? 'unknown',
            symbol: match?.SymbolProfile?.symbol ?? 'TSLA',
            type: match?.type ?? 'BUY',
            unitPrice: match?.unitPrice ?? 399.83
          }
        ]
      });
    },
    updateOrder: async (inputOrRun, input) => {
      track('update_order', inputOrRun, input);
      return buildResult({
        answer: 'Please provide the order/activity id to update.',
        needsClarification: true,
        summary: 'Order id required'
      });
    }
  };
}

function createTrackedTools(baseTools: AgentTools, captures: ToolCapture[]): AgentTools {
  const track = (tool: AgentToolName, inputOrRun: AgentToolInput, input?: AgentToolInput) => {
    captures.push({ input: resolveInput(inputOrRun, input), tool });
  };
  const marketOverview = baseTools.marketOverview;

  return {
    createOrder: async (inputOrRun, input) => {
      track('create_order', inputOrRun, input);
      return baseTools.createOrder(inputOrRun, input);
    },
    getTransactions: async (inputOrRun, input) => {
      track('get_transactions', inputOrRun, input);
      return baseTools.getTransactions(inputOrRun, input);
    },
    marketData: async (inputOrRun, input) => {
      track('market_data', inputOrRun, input);
      return baseTools.marketData(inputOrRun, input);
    },
    marketDataLookup: async (inputOrRun, input) => {
      track('market_data_lookup', inputOrRun, input);
      return baseTools.marketDataLookup(inputOrRun, input);
    },
    marketOverview: marketOverview
      ? async (inputOrRun, input) => {
          track('market_overview', inputOrRun, input);
          return marketOverview(inputOrRun, input);
        }
      : undefined,
    portfolioAnalysis: async (inputOrRun, input) => {
      track('portfolio_analysis', inputOrRun, input);
      return baseTools.portfolioAnalysis(inputOrRun, input);
    },
    transactionCategorize: async (inputOrRun, input) => {
      track('transaction_categorize', inputOrRun, input);
      return baseTools.transactionCategorize(inputOrRun, input);
    },
    transactionTimeline: async (inputOrRun, input) => {
      track('transaction_timeline', inputOrRun, input);
      return baseTools.transactionTimeline(inputOrRun, input);
    },
    updateOrder: async (inputOrRun, input) => {
      track('update_order', inputOrRun, input);
      return baseTools.updateOrder(inputOrRun, input);
    }
  };
}

function resolveInput(inputOrRun: AgentToolInput, input?: AgentToolInput): AgentToolInput {
  if (input && typeof input.message === 'string') {
    return input;
  }

  return inputOrRun;
}

function buildResult(partial: Record<string, unknown>) {
  return {
    data_as_of: '2026-02-24T00:00:00Z',
    sources: ['eval_fixture'],
    ...partial
  };
}

async function evaluateCase({
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

  const routeCheck = checkExpectedRoute(testCase.expectation, response);
  if (routeCheck) {
    checks.push(routeCheck);
  }

  if (testCase.expectedToolCalls.length > 0) {
    checks.push(...checkTextContains(testCase.expectedOutput, comparableText, 'expected output', 'correctness'));
  }

  return checks;
}

function evaluateStaticDimension({
  comparableText,
  captures,
  dimension,
  durationMs,
  llmTrace,
  response,
  testCase
}: {
  comparableText: string;
  captures: ToolCapture[];
  dimension: Exclude<EvalDimension, 'consistency'>;
  durationMs: number;
  llmTrace: LlmTrace;
  response: AgentChatResponse;
  testCase: EvalCase;
}): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const { expectation } = testCase;

  if (dimension === 'tool_selection') {
    checks.push(checkToolSelection(expectation, response));
  }

  if (dimension === 'tool_execution') {
    checks.push(...checkToolExecution(expectation, response, captures));
  }

  if (dimension === 'correctness') {
    checks.push(...checkTextContains(expectation.groundTruthContains, comparableText, 'ground truth', dimension));
  }

  if (dimension === 'safety' || dimension === 'edge_cases') {
    checks.push(...checkSafetyAndEdge(expectation, response, llmTrace, dimension));
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
  const runs = testCase.expectation.repeatRuns ?? 2;
  const captures: ToolCapture[] = [];
  const tools = options.tools ? createTrackedTools(options.tools, captures) : createEvalTools(captures);
  const agent = createAgent({ llm, tools });
  const answers: string[] = [];
  const toolSignatures: string[] = [];

  for (let i = 0; i < runs; i++) {
    const response = await agent.chat({
      conversationId: `eval-consistency-${testCase.id}-${i}`,
      impersonationId: options.requestImpersonationId,
      message: testCase.inputQuery,
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

function validateEvalCaseContract(testCase: EvalCase): void {
  const missing: string[] = [];
  if (typeof testCase.id !== 'string' || !testCase.id.trim()) missing.push('id');
  if (typeof testCase.inputQuery !== 'string' || !testCase.inputQuery.trim()) missing.push('inputQuery');
  if (!Array.isArray(testCase.expectedToolCalls)) missing.push('expectedToolCalls');
  if (!Array.isArray(testCase.expectedOutput) || testCase.expectedOutput.length === 0) {
    missing.push('expectedOutput');
  }
  if (!Array.isArray(testCase.passFailCriteria) || testCase.passFailCriteria.length === 0) {
    missing.push('passFailCriteria');
  }
  if (missing.length > 0) {
    throw new Error(`Eval case ${testCase.id || '<unknown>'} missing required fields: ${missing.join(', ')}`);
  }
}

async function withEvalLogFilter<T>(
  run: () => Promise<T>,
  options: { suppressNonEvalLogs: boolean }
): Promise<T> {
  if (!options.suppressNonEvalLogs) {
    return run();
  }

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const allow = (args: unknown[]) => typeof args[0] === 'string' && args[0].startsWith('[eval]');

  console.log = (...args: unknown[]) => {
    if (allow(args)) {
      originalLog(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    if (allow(args)) {
      originalWarn(...args);
    }
  };
  console.error = (...args: unknown[]) => {
    if (allow(args)) {
      originalError(...args);
    }
  };

  try {
    return await run();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function checkToolSelection(expectation: EvalCaseExpectation, response: AgentChatResponse): EvalCheckResult {
  const usedTools = response.toolCalls.map((call) => call.toolName);
  const expected = expectation.expectedPrimaryTool;
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
  expectation: EvalCaseExpectation,
  response: AgentChatResponse,
  captures: ToolCapture[]
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const successful = response.toolCalls.every((call) => call.success);
  if (expectation.requireSuccessfulToolCalls) {
    checks.push({
      dimension: 'tool_execution',
      message: 'all invoked tool calls succeeded',
      passed: successful
    });
  }

  if (expectation.expectedToolCountAtLeast !== undefined) {
    checks.push({
      dimension: 'tool_execution',
      message: `tool call count >= ${expectation.expectedToolCountAtLeast}`,
      passed: response.toolCalls.length >= expectation.expectedToolCountAtLeast
    });
  }

  if (expectation.expectedTools?.length) {
    const missing = expectation.expectedTools.filter(
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

  if (expectation.requiredToolInputFields) {
    checks.push(...checkRequiredToolInputFields(expectation.requiredToolInputFields, captures));
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
  expectation: EvalCaseExpectation,
  response: AgentChatResponse,
  llmTrace: LlmTrace,
  dimension: 'safety' | 'edge_cases'
): EvalCheckResult[] {
  const checks: EvalCheckResult[] = [];
  const trace = response.trace ?? [];

  if (expectation.expectedValidity !== undefined) {
    checks.push({
      dimension,
      message: `verification isValid == ${expectation.expectedValidity}`,
      passed: response.verification.isValid === expectation.expectedValidity
    });
  }

  if (expectation.expectedFlags?.length) {
    const missingFlags = expectation.expectedFlags.filter(
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

  checks.push(...checkTextContains(expectation.mustContain, response.answer, 'answer', dimension));
  checks.push(...checkTextNotContains(expectation.mustNotContain, response.answer, 'answer', dimension));

  if (expectation.requireLlmAnswer) {
    checks.push({
      dimension,
      message: 'llm answer path was invoked',
      passed: llmTrace.answerCalls > 0 || trace.some((step) => step.type === 'llm' && step.name === 'answer')
    });
  }

  if (expectation.requireLlmReasoning) {
    checks.push({
      dimension,
      message: 'llm reasoning path was invoked',
      passed: llmTrace.reasoningCalls > 0 || trace.some((step) => step.type === 'llm' && step.name === 'route')
    });
  }

  if (expectation.requireLlmSynthesis) {
    checks.push({
      dimension,
      message: 'llm synthesis path was invoked',
      passed:
        llmTrace.synthesisCalls > 0 ||
        trace.some((step) => step.type === 'llm' && step.name === 'synthesize')
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

function summarizeByDimension(results: EvalCaseResult[]): Record<EvalDimension, EvalDimensionSummary> {
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

function passesGate({
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

function checkExpectedRoute(
  expectation: EvalCaseExpectation,
  response: AgentChatResponse
): EvalCheckResult | undefined {
  if (!expectation.expectedRoute) {
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

  if (expectation.expectedRoute === 'llm_user') {
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

function createEvalLlm(trace: LlmTrace): AgentLlm {
  return {
    answerFinanceQuestion: async (message: string) => {
      trace.answerCalls += 1;
      const normalized = message.toLowerCase();
      if (normalized.includes('hello')) {
        return 'Hi. I can help with portfolio, transactions, and market-data questions.';
      }
      if (normalized.includes('joke')) {
        return 'Finance joke: I tried to beat the market, but my fees beat me first.';
      }
      return 'I can help with portfolio, market data, and transaction questions.';
    },
    reasonAboutQuery: async (message: string) => {
      trace.reasoningCalls += 1;
      const normalized = message.toLowerCase();
      if (
        normalized.includes('hello') ||
        normalized.includes('joke') ||
        normalized.includes('what should i do now')
      ) {
        return { intent: 'general', mode: 'direct_reply', tool: 'none' };
      }
      return { intent: 'finance', mode: 'tool_call', tool: 'none' };
    },
    selectTool: async () => ({ tool: 'none' }),
    synthesizeFromToolResults: async (...args) => {
      const [, , toolSummary] = args;
      trace.synthesisCalls += 1;
      return toolSummary;
    }
  };
}

function colorizeStatus(status: string, passed: boolean): string {
  const green = '\u001b[32m';
  const red = '\u001b[31m';
  const reset = '\u001b[0m';
  return `${passed ? green : red}${status}${reset}`;
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
