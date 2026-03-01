import { createAgent } from '../../server/agent';
import type { AgentTools } from '../../server/types';

function buildTools(overrides: Partial<AgentTools> = {}): AgentTools {
  return {
    complianceCheck: jest.fn().mockResolvedValue({}),
    factComplianceCheck: jest.fn().mockResolvedValue({}),
    createOrder: jest.fn().mockResolvedValue({
      answer: 'Please confirm order details.',
      needsClarification: true
    }),
    factCheck: jest.fn().mockResolvedValue({}),
    getOrders: jest.fn().mockResolvedValue({}),
    getTransactions: jest.fn().mockResolvedValue({}),
    marketData: jest.fn().mockResolvedValue({}),
    marketDataLookup: jest.fn().mockResolvedValue({}),
    staticAnalysis: jest.fn().mockResolvedValue({}),
    holdingsAnalysis: jest.fn().mockResolvedValue({}),
    portfolioSummary: jest.fn().mockResolvedValue({}),
    portfolioAnalysis: jest.fn().mockResolvedValue({}),
    transactionCategorize: jest.fn().mockResolvedValue({}),
    transactionTimeline: jest.fn().mockResolvedValue({}),
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
    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ success: true, toolName: 'compliance_check' })
      ])
    );
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

  it('does not trigger create_order for buy/sell ratio analytics requests', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please confirm order details.',
      needsClarification: true
    });
    const transactionCategorize = jest.fn().mockResolvedValue({
      answer: 'Categorized transactions.',
      categories: [{ category: 'BUY', count: 13 }, { category: 'SELL', count: 3 }],
      data_as_of: '2026-02-25T00:00:00.000Z',
      patterns: { buySellRatio: 4.33 },
      sources: ['agent_internal'],
      summary: 'Categorized 16 transactions'
    });
    const tools = buildTools({ createOrder, transactionCategorize });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'needs transaction patterns',
          tool: 'transaction_categorize',
          tools: ['transaction_categorize']
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'transaction_categorize' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-order-intent-ratio',
      message: 'what is my buy sell ratio',
      token: 'jwt-token'
    });

    expect(transactionCategorize).toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('strips create_order when LLM mixes it into non-order analytics tool list', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please confirm order details.',
      needsClarification: true
    });
    const transactionCategorize = jest.fn().mockResolvedValue({
      answer: 'Categorized transactions.',
      categories: [{ category: 'BUY', count: 13 }, { category: 'SELL', count: 3 }],
      data_as_of: '2026-02-25T00:00:00.000Z',
      patterns: { buySellRatio: 4.33 },
      sources: ['agent_internal'],
      summary: 'Categorized 16 transactions'
    });
    const tools = buildTools({ createOrder, transactionCategorize });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'needs analytics',
          tools: ['transaction_categorize', 'create_order']
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'transaction_categorize' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-order-intent-mixed-tools',
      message: 'what is my buy sell ratio',
      token: 'jwt-token'
    });

    expect(transactionCategorize).toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('does not keep pending create_order flow for historical transaction lookup questions', async () => {
    const createOrder = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'Please confirm order details.',
        needsClarification: true
      })
      .mockResolvedValue({
        answer: 'Should not be called on historical lookup turn.',
        needsClarification: true
      });
    const transactionTimeline = jest.fn().mockResolvedValue({
      answer: 'You bought AAPL on 2025-06-12 at 203.43.',
      data_as_of: '2026-02-26T00:00:00.000Z',
      sources: ['agent_internal'],
      summary: 'Transaction timeline returned 1 event(s).',
      timeline: [{ date: '2025-06-12', symbol: 'AAPL', type: 'BUY', unitPrice: 203.43 }]
    });
    const tools = buildTools({ createOrder, transactionTimeline });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest
          .fn()
          .mockResolvedValueOnce({
            intent: 'finance',
            mode: 'tool_call',
            rationale: 'explicit execution',
            tool: 'create_order'
          })
          .mockResolvedValueOnce({
            intent: 'finance',
            mode: 'tool_call',
            rationale: 'historical transaction lookup',
            tool: 'transaction_timeline'
          }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    await agent.chat({
      conversationId: 'conv-pending-order-should-not-hijack-history',
      message: 'buy 2 AAPL',
      token: 'jwt-token'
    });

    await agent.chat({
      conversationId: 'conv-pending-order-should-not-hijack-history',
      message: 'what did i buy last year',
      token: 'jwt-token'
    });

    expect(transactionTimeline).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});

  it('routes advisory buy question to compliance_check instead of pure direct LLM', async () => {
    const complianceCheck = jest.fn().mockResolvedValue({
      answer: 'Compliance check found blocking policy violations.',
      data_as_of: '2026-02-26',
      isCompliant: false,
      policyVersion: 'us-baseline-v1',
      sources: ['policy_pack'],
      summary: 'Compliance check completed with 1 violation(s) and 0 warning(s).',
      violations: [{ rule_id: 'R-FINRA-2111', severity: 'violation' }],
      warnings: []
    });

    const tools = buildTools({ complianceCheck });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
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
      conversationId: 'conv-order-intent-advisory-compliance',
      message: 'Should I buy TSLA now?',
      token: 'jwt-token'
    });

    expect(complianceCheck).toHaveBeenCalledTimes(1);
    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ success: true, toolName: 'compliance_check' })
      ])
    );
  });

  it('does not route explicit compliance-check phrasing to create_order', async () => {
    const createOrder = jest.fn().mockResolvedValue({
      answer: 'Please choose an account for this order.',
      needsClarification: true
    });
    const complianceCheck = jest.fn().mockResolvedValue({
      answer: 'Compliance check completed.',
      data_as_of: '2026-02-26',
      isCompliant: true,
      policyVersion: 'us-baseline-v1',
      sources: ['policy_pack:us-baseline-v1'],
      summary: 'Compliance check completed with 0 violation(s) and 0 warning(s).',
      violations: [],
      warnings: []
    });
    const tools = buildTools({ complianceCheck, createOrder });
    const agent = createAgent({
      llm: {
        answerFinanceQuestion: jest.fn().mockResolvedValue('fallback'),
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'finance',
          mode: 'tool_call',
          rationale: 'explicit compliance request',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({ tool: 'none' })
      },
      tools
    });

    const response = await agent.chat({
      conversationId: 'conv-order-intent-compliance-phrase',
      message: 'Run a compliance check for this trade: buy 10 AAPL',
      token: 'jwt-token'
    });

    expect(complianceCheck).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();
    expect(response.answer).toContain('I ran a compliance check');
    expect(response.answer).toContain('no blocking violations');
    expect(response.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ success: true, toolName: 'compliance_check' })
      ])
    );
  });
