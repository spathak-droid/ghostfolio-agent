import { createAgent } from '../../server/agent';
import type { AgentTools } from '../../server/types';

function buildTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    createOrder: jest.fn().mockResolvedValue({
      answer: 'Please confirm order details.',
      needsClarification: true
    }),
    getTransactions: jest.fn().mockResolvedValue({}),
    marketData: jest.fn().mockResolvedValue({}),
    marketDataLookup: jest.fn().mockResolvedValue({}),
    portfolioAnalysis: jest.fn().mockResolvedValue({}),
    transactionCategorize: jest.fn().mockResolvedValue({}),
    transactionTimeline: jest.fn().mockResolvedValue({}),
    updateOrder: jest.fn().mockResolvedValue({
      answer: 'Please confirm update details.',
      needsClarification: true
    }),
    ...overrides
  };
}

describe('order-intent routing', () => {
  it('does not trigger create_order for advisory buy questions', async () => {
    const answerFinanceQuestion = jest
      .fn()
      .mockResolvedValue('This depends on your risk tolerance and time horizon.');
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please confirm order details.',
      needsClarification: true
    });
    const tools = buildTools({ createOrder });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'general',
          mode: 'direct_reply',
          rationale: 'opinion question',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const response = await agent.chat({
      conversationId: 'conv-order-intent-advisory',
      message: 'should i buy apple stock?',
      token: 'jwt-token'
    });

    expect(createOrder).not.toHaveBeenCalled();
    expect(response.toolCalls).toHaveLength(0);
    expect(answerFinanceQuestion).toHaveBeenCalled();
  });

  it('still triggers create_order for explicit execution intent', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please confirm order details.',
      needsClarification: true
    });
    const tools = buildTools({ createOrder });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'general',
          mode: 'direct_reply',
          rationale: 'model uncertain',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const response = await agent.chat({
      conversationId: 'conv-order-intent-execution',
      message: 'buy 5 AAPL now',
      token: 'jwt-token'
    });

    expect(createOrder).toHaveBeenCalled();
    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ success: true, toolName: 'create_order' })
      ])
    );
  });
});

