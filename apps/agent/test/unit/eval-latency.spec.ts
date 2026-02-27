import { evaluateCase } from '../../server/eval/eval-checks';
import type { EvalCase } from '../../server/eval/eval-types';
import type { AgentChatResponse, AgentToolCall } from '../../server/types';

const baseCase: EvalCase = {
  id: 'latency-base',
  difficulty: 'edge',
  query: 'latency check',
  expectedTools: [],
  passFailCriteria: ['latency policy should be enforced'],
  dimensions: ['latency'],
  mustContain: [],
  mustNotContain: []
};

function createResponse(toolCallCount: number): AgentChatResponse {
  const toolCall: AgentToolCall = {
    toolName: 'market_data_lookup',
    success: true,
    result: { summary: 'ok' }
  };

  return {
    answer: 'ok',
    conversation: [{ role: 'assistant', content: 'ok' }],
    errors: [],
    toolCalls: Array.from({ length: toolCallCount }, () => toolCall),
    verification: { confidence: 0.9, flags: [], isValid: true }
  };
}

async function latencyPassed(toolCalls: number, durationMs: number): Promise<boolean> {
  const checks = await evaluateCase({
    captures: [],
    durationMs,
    llm: undefined,
    llmTrace: { answerCalls: 0, reasoningCalls: 0 },
    options: {},
    response: createResponse(toolCalls),
    testCase: {
      ...baseCase,
      id: `latency-${toolCalls}-${durationMs}`
    }
  });

  const latency = checks.find((item) => item.dimension === 'latency');
  return latency?.passed ?? false;
}

describe('eval latency thresholds', () => {
  it('enforces default latency budgets by tool-call count', async () => {
    await expect(latencyPassed(1, 4_999)).resolves.toBe(true);
    await expect(latencyPassed(1, 5_000)).resolves.toBe(false);

    await expect(latencyPassed(2, 7_999)).resolves.toBe(true);
    await expect(latencyPassed(2, 8_000)).resolves.toBe(false);

    await expect(latencyPassed(3, 11_999)).resolves.toBe(true);
    await expect(latencyPassed(3, 12_000)).resolves.toBe(false);

    await expect(latencyPassed(4, 14_999)).resolves.toBe(true);
    await expect(latencyPassed(4, 15_000)).resolves.toBe(false);
    await expect(latencyPassed(5, 14_999)).resolves.toBe(true);
    await expect(latencyPassed(5, 15_000)).resolves.toBe(false);
  });

  it('honors explicit per-case latencyMsMax override', async () => {
    const checks = await evaluateCase({
      captures: [],
      durationMs: 200,
      llm: undefined,
      llmTrace: { answerCalls: 0, reasoningCalls: 0 },
      options: {},
      response: createResponse(1),
      testCase: {
        ...baseCase,
        id: 'latency-override',
        latencyMsMax: 100
      }
    });

    expect(checks.find((item) => item.dimension === 'latency')?.passed).toBe(false);
  });
});
