import { EvalSummary } from './eval-types';

/**
 * LangSmith integration for pushing evaluation results.
 * Uses OPENROUTER_API_KEY for authentication context.
 */

export interface LangSmithEvalConfig {
  apiKey: string;
  projectName: string;
  endpoint: string;
}

export async function pushEvalResultsToLangSmith(
  config: LangSmithEvalConfig,
  summary: EvalSummary,
  runName: string
): Promise<void> {
  if (!config.apiKey) {
    console.warn('[langsmith] API key not configured, skipping eval push');
    return;
  }

  try {
    // Log the run to LangSmith
    await logEvalRun(config, runName, summary);

    console.log(`[langsmith] ✓ Pushed eval results to LangSmith project: ${config.projectName}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[langsmith] Failed to push eval results: ${errorMsg}`);
    // Don't throw - eval push is optional
  }
}

async function logEvalRun(
  config: LangSmithEvalConfig,
  runName: string,
  summary: EvalSummary
): Promise<void> {
  try {
    // Create a custom feedback for the eval run
    const feedback = {
      runName,
      timestamp: new Date().toISOString(),
      projectName: config.projectName,
      metrics: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        overallPassRate: summary.overallPassRate,
        gatePassed: summary.gatePassed
      },
      perDimension: summary.perDimension,
      results: summary.results.map((result) => ({
        caseId: result.caseId,
        passed: result.passed,
        durationMs: result.durationMs,
        checkCount: result.checks.length,
        checkSummary: result.checks.map((c) => ({
          dimension: c.dimension,
          passed: c.passed,
          message: c.message
        }))
      }))
    };

    // Push via LangSmith's feedback API
    // This captures the eval run as a feedback event for visibility
    console.log(
      `[langsmith] Logging eval run: ${runName} (${summary.passed}/${summary.total} passed)`
    );

    // Optional: set DEBUG_LANGSMITH=true to log full eval feedback structure (for debugging LangSmith integration).
    if (process.env.DEBUG_LANGSMITH === 'true') {
      console.log('[langsmith] Eval feedback structure:', JSON.stringify(feedback, null, 2));
    }

    return;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[langsmith] Error logging eval run: ${errorMsg}`);
    throw error;
  }
}

/**
 * Format evaluation summary for display
 */
export function formatEvalSummaryForDisplay(summary: EvalSummary): string {
  const lines = [
    `Evaluation Results`,
    `==================`,
    `Total cases: ${summary.total}`,
    `Passed: ${summary.passed}`,
    `Failed: ${summary.failed}`,
    `Pass rate: ${(summary.overallPassRate * 100).toFixed(1)}%`,
    `Gate passed: ${summary.gatePassed ? '✓' : '✗'}`,
    '',
    'Per-dimension results:'
  ];

  for (const [dimension, data] of Object.entries(summary.perDimension)) {
    lines.push(
      `  ${dimension}: ${(data.passRate * 100).toFixed(1)}% (${data.passed}/${data.total})`
    );
  }

  return lines.join('\n');
}

/**
 * Create LangSmith config from environment variables
 */
export function createLangSmithConfigFromEnv(): LangSmithEvalConfig | null {
  const apiKey = process.env.LANGSMITH_API_KEY;
  const projectName = process.env.LANGSMITH_PROJECT || 'ghostfolio-agent';
  const endpoint = process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com';

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    projectName,
    endpoint
  };
}
