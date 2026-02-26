import { createAgent } from '../agent';
import {
  EvalCase,
  EvalCaseResult,
  EvalRunOptions,
  EvalSummary,
  LlmTrace,
  ToolCapture
} from './eval-types';
import { evaluateCase, passesGate, summarizeByDimension, validateEvalCaseContract } from './eval-checks';
import { colorizeStatus, withEvalLogFilter } from './eval-output';
import { createEvalLlm, createEvalTools, createTrackedTools } from './eval-tools';

export type {
  EvalCase,
  EvalCaseResult,
  EvalCheckResult,
  EvalDifficulty,
  EvalDimension,
  EvalDimensionSummary,
  EvalRunOptions,
  EvalSummary
} from './eval-types';

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
          message: testCase.query,
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
          const expectedTools = testCase.expectedTools.length
            ? testCase.expectedTools.join(',')
            : 'none';
          const expectedOutput = (testCase.expectedOutput ?? []).join(' | ');
          const colorStatus = colorizeStatus(status, last.passed);
          console.log(`[eval] CASE id=${testCase.id}`);
          console.log(`[eval]   input=${JSON.stringify(testCase.query)}`);
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
