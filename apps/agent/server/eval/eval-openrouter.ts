/**
 * OpenRouter API wrapper for evaluations with LangSmith integration.
 * Uses OPENROUTER_API_KEY for LLM-based evaluation scoring.
 */

import { traceable } from 'langsmith/traceable';

export interface OpenRouterEvalConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export async function evaluateWithOpenRouter(
  config: OpenRouterEvalConfig,
  prompt: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  return traceable(
    async (input: string) => {
      if (!config.apiKey) {
        throw new Error('OPENROUTER_API_KEY is required for LLM-based evaluation');
      }

      const response = await fetch(config.baseUrl || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'HTTP-Referer': 'https://ghostfolio.io',
          'X-Title': 'Ghostfolio Agent Evals'
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content:
                'You are an evaluator for a finance AI agent. Provide brief, structured evaluations.'
            },
            {
              role: 'user',
              content: input
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenRouter response');
      }

      return content;
    },
    {
      name: 'eval.openrouter_evaluate',
      metadata: {
        model: config.model,
        ...metadata
      },
      run_type: 'llm'
    }
  )(prompt);
}

/**
 * Score eval case result using OpenRouter
 */
export async function scoreEvalCaseWithOpenRouter(
  config: OpenRouterEvalConfig,
  caseId: string,
  query: string,
  expectedOutput: string[],
  actualOutput: string
): Promise<{ score: number; reasoning: string }> {
  const scoringPrompt = `
Evaluate the following agent response:

Case ID: ${caseId}
Query: "${query}"
Expected patterns: ${expectedOutput.join(' | ')}
Actual response: "${actualOutput}"

Score this response on a scale of 0-100 considering:
1. Does it address the user's question?
2. Is the information accurate?
3. Are required patterns/tools mentioned?

Respond in format: SCORE: <0-100>\nREASONING: <brief explanation>
`;

  try {
    const result = await evaluateWithOpenRouter(config, scoringPrompt, {
      caseId,
      evaluationType: 'case_scoring'
    });

    // Parse the response
    const scoreRegex = /SCORE:\s*(\d+)/;
    const reasoningRegex = /REASONING:\s*([\s\S]+?)(?:\n|$)/;
    const scoreMatch = scoreRegex.exec(result);
    const reasoningMatch = reasoningRegex.exec(result);

    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'Unable to parse reasoning';

    return {
      score: Math.min(100, Math.max(0, score)),
      reasoning
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(`[eval.openrouter] Scoring failed: ${errorMsg}`);
    return {
      score: 0,
      reasoning: `Error: ${errorMsg}`
    };
  }
}

/**
 * Create OpenRouter config from environment variables
 */
export function createOpenRouterConfigFromEnv(): OpenRouterEvalConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model,
    baseUrl: process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions'
  };
}

/**
 * Check if OpenRouter is available
 */
export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}
