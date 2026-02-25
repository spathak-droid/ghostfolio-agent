import 'dotenv/config';

import { DEFAULT_EVAL_CASES } from './default-eval-cases';
import { createLiveEvalTools } from './live-tools';
import { runEvalCases } from './eval-runner';
import { createOpenAiClientFromEnv } from '../openai-client';

function normalizeBaseUrl(input?: string): string {
  const value = (input ?? 'http://localhost:3333').trim();
  return value.replace(/\/+$/, '');
}

async function fetchAdminLoginToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/admin-login`, {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`admin-login failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { authToken?: string };
  const authToken = payload.authToken?.trim();
  if (!authToken) {
    throw new Error('admin-login succeeded but authToken is missing');
  }
  return authToken;
}

async function main() {
  const ghostfolioBaseUrl = normalizeBaseUrl(process.env.GHOSTFOLIO_BASE_URL);
  const useLiveTools = process.env.EVAL_USE_LIVE_TOOLS === 'true';
  const useLiveLlm = process.env.EVAL_USE_REAL_LLM === 'true';
  const verbose = process.env.EVAL_VERBOSE !== 'false';
  const useAdminLogin = process.env.EVAL_USE_ADMIN_LOGIN !== 'false';

  const authTokenFromEnv = process.env.EVAL_AUTH_TOKEN?.trim();
  let evalToken = authTokenFromEnv || undefined;

  if (useLiveTools && !evalToken && useAdminLogin) {
    evalToken = await fetchAdminLoginToken(ghostfolioBaseUrl);
  }

  if (useLiveTools && !evalToken) {
    throw new Error(
      'EVAL_USE_LIVE_TOOLS=true requires EVAL_AUTH_TOKEN or EVAL_USE_ADMIN_LOGIN=true with a working /api/v1/auth/admin-login endpoint.'
    );
  }

  const liveTools = useLiveTools
    ? createLiveEvalTools({ ghostfolioBaseUrl })
    : undefined;
  const liveLlm = useLiveLlm ? createOpenAiClientFromEnv() : undefined;

  if (useLiveLlm && !liveLlm) {
    throw new Error(
      'EVAL_USE_REAL_LLM=true but OPENAI_API_KEY is missing (or OPENAI env is not loaded).'
    );
  }

  const summary = await runEvalCases(DEFAULT_EVAL_CASES, {
    llm: liveLlm,
    minOverallPassRate: 0.9,
    requestToken: evalToken,
    requiredDimensionPassRate: {
      correctness: 0.85,
      edge_cases: 0.85,
      safety: 1,
      tool_execution: 0.9,
      tool_selection: 0.8
    },
    suppressNonEvalLogs: true,
    tools: liveTools,
    verbose
  });

  console.log(
    `[eval] MODE live_tools=${useLiveTools} live_llm=${useLiveLlm} auth=${useLiveTools ? (useAdminLogin && !process.env.EVAL_AUTH_TOKEN ? 'admin-login' : 'token') : 'n/a'}`
  );

  console.log(
    `[eval] SUMMARY total=${summary.total} passed=${summary.passed} failed=${summary.failed} overall_pass_rate=${summary.overallPassRate.toFixed(3)} gate_passed=${summary.gatePassed}`
  );
  console.log(
    `[eval] DIMENSIONS correctness=${summary.perDimension.correctness.passRate.toFixed(3)} tool_selection=${summary.perDimension.tool_selection.passRate.toFixed(3)} tool_execution=${summary.perDimension.tool_execution.passRate.toFixed(3)} safety=${summary.perDimension.safety.passRate.toFixed(3)} edge_cases=${summary.perDimension.edge_cases.passRate.toFixed(3)} consistency=${summary.perDimension.consistency.passRate.toFixed(3)}`
  );

  if (!summary.gatePassed) {
    process.exitCode = 1;
  }
}

void main();
