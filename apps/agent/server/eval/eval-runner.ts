import { createAgent } from '../agent';

export interface EvalCase {
  input: string;
  expectedTool?: 'market_data_lookup' | 'portfolio_analysis' | 'transaction_categorize';
  expectedContains?: string;
  expectedFlag?: string;
}

export interface EvalSummary {
  failed: number;
  passed: number;
  results: { index: number; passed: boolean; reason?: string }[];
  total: number;
}

export async function runEvalCases(cases: EvalCase[]): Promise<EvalSummary> {
  const agent = createAgent({
    tools: {
      marketDataLookup: async () => {
        return { summary: 'Market data lookup from Ghostfolio API' };
      },
      portfolioAnalysis: async () => {
        return { summary: 'Diversified portfolio composition' };
      },
      transactionCategorize: async ({ message }) => {
        return { input: message, summary: 'Categorized transactions' };
      }
    }
  });

  const results: EvalSummary['results'] = [];

  for (const [index, testCase] of cases.entries()) {
    const response = await agent.chat({
      conversationId: `eval-${index}`,
      message: testCase.input,
      token: undefined
    });

    const usedTool = response.toolCalls[0]?.toolName;

    if (testCase.expectedTool && usedTool !== testCase.expectedTool) {
      results.push({
        index,
        passed: false,
        reason: `expected tool ${testCase.expectedTool} but got ${usedTool ?? 'none'}`
      });
      continue;
    }

    if (
      testCase.expectedContains &&
      !response.answer.toLowerCase().includes(testCase.expectedContains.toLowerCase())
    ) {
      results.push({
        index,
        passed: false,
        reason: `answer missing expected fragment: ${testCase.expectedContains}`
      });
      continue;
    }

    if (
      testCase.expectedFlag &&
      !response.verification.flags?.includes(testCase.expectedFlag)
    ) {
      results.push({
        index,
        passed: false,
        reason: `missing expected verification flag: ${testCase.expectedFlag}`
      });
      continue;
    }

    results.push({ index, passed: true });
  }

  const passed = results.filter(({ passed: resultPassed }) => resultPassed).length;

  return {
    failed: results.length - passed,
    passed,
    results,
    total: results.length
  };
}
