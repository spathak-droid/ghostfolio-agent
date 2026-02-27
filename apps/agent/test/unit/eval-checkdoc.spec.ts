import { evaluateCase, validateEvalCaseContract } from '../../server/eval/eval-checks';
import type { EvalCase } from '../../server/eval/eval-types';

const baseCase: EvalCase = {
  id: 'checkdoc-base',
  difficulty: 'edge',
  query: 'hello',
  expectedTools: [],
  expectedOutput: ['hi'],
  passFailCriteria: ['contract valid'],
  dimensions: ['edge_cases'],
  mustContain: [],
  mustNotContain: []
};

describe('eval checkDoc support', () => {
  it('accepts checkDoc when it points to an existing markdown file', () => {
    const testCase: EvalCase = {
      ...baseCase,
      checkDoc: 'docs/agent/compliance-regulations-us.md',
      id: 'checkdoc-valid'
    };

    expect(() => validateEvalCaseContract(testCase)).not.toThrow();
  });

  it('adds failing check when checkDoc path is missing', async () => {
    const testCase: EvalCase = {
      ...baseCase,
      checkDoc: 'docs/agent/does-not-exist.md',
      id: 'checkdoc-missing'
    };

    const checks = await evaluateCase({
      captures: [],
      durationMs: 1,
      llm: undefined,
      llmTrace: { answerCalls: 0, reasoningCalls: 0 },
      options: {},
      response: {
        answer: 'hi',
        conversation: [{ role: 'assistant', content: 'hi' }],
        errors: [],
        toolCalls: [],
        verification: { confidence: 0.82, flags: [], isValid: true }
      },
      testCase
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('checkDoc exists'),
          passed: false
        })
      ])
    );
  });
});
