import { decideRoute } from '../../server/agent-llm-runtime';
import type { AgentConversationMessage, AgentLlm, AgentTraceContext } from '../../server/types';

const TRACE_CONTEXT: AgentTraceContext = {
  conversationId: 'conv-routing-1',
  messagePreview: 'preview',
  sessionId: 'session-1',
  turnId: 1
};

function createLlmMock({
  reasonAboutQuery,
  selectTool
}: {
  reasonAboutQuery?: AgentLlm['reasonAboutQuery'];
  selectTool?: AgentLlm['selectTool'];
}): AgentLlm {
  return {
    answerFinanceQuestion: jest.fn().mockResolvedValue('answer'),
    extractComplianceFacts: jest.fn().mockResolvedValue(undefined),
    getToolParametersForOrder: jest.fn().mockResolvedValue(undefined),
    reasonAboutQuery,
    selectTool: selectTool ?? jest.fn().mockResolvedValue({ tool: 'none' })
  };
}

describe('agent llm runtime routing', () => {
  it('uses reasonAboutQuery as the only LLM routing call when available', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'finance',
      mode: 'tool_call',
      tool: 'market_data'
    });
    const selectTool = jest.fn().mockResolvedValue({ tool: 'portfolio_analysis' });
    const llm = createLlmMock({ reasonAboutQuery, selectTool });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'what is bitcoin price',
      traceContext: TRACE_CONTEXT
    });

    expect(result.tools).toEqual(
      expect.arrayContaining(['market_data', 'fact_check'])
    );
    expect(result.tools.indexOf('market_data')).toBeLessThan(
      result.tools.indexOf('fact_check')
    );
    expect(reasonAboutQuery).toHaveBeenCalledTimes(1);
    expect(selectTool).not.toHaveBeenCalled();
  });

  it('falls back to keyword routing when reasonAboutQuery fails without calling selectTool', async () => {
    const reasonAboutQuery = jest.fn().mockRejectedValue(new Error('timeout'));
    const selectTool = jest.fn().mockResolvedValue({ tool: 'portfolio_analysis' });
    const llm = createLlmMock({ reasonAboutQuery, selectTool });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'what is bitcoin price',
      traceContext: TRACE_CONTEXT
    });

    expect(result.tools).toEqual(
      expect.arrayContaining(['market_data', 'fact_check'])
    );
    expect(result.tools.indexOf('market_data')).toBeLessThan(
      result.tools.indexOf('fact_check')
    );
    expect(reasonAboutQuery).toHaveBeenCalledTimes(1);
    expect(selectTool).not.toHaveBeenCalled();
  });

  it('keeps direct_reply retrieval exception behavior', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'finance',
      mode: 'direct_reply',
      tool: 'none'
    });
    const llm = createLlmMock({ reasonAboutQuery });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'what is bitcoin price last month',
      traceContext: TRACE_CONTEXT
    });

    expect(result.tools).toEqual(
      expect.arrayContaining(['market_data', 'fact_check'])
    );
    expect(result.tools.indexOf('market_data')).toBeLessThan(
      result.tools.indexOf('fact_check')
    );
  });

  it('routes price queries through market_data then fact_check', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'finance',
      mode: 'tool_call',
      tool: 'market_data'
    });
    const llm = createLlmMock({ reasonAboutQuery });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'what is the price of bitcoin?',
      traceContext: TRACE_CONTEXT
    });

    expect(result.tools).toEqual(
      expect.arrayContaining(['market_data', 'fact_check'])
    );
    expect(result.tools.indexOf('market_data')).toBeLessThan(
      result.tools.indexOf('fact_check')
    );
  });

  it('does not force fact_check for non-price finance queries', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'finance',
      mode: 'tool_call',
      tool: 'portfolio_analysis'
    });
    const llm = createLlmMock({ reasonAboutQuery });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'analyze my portfolio performance',
      traceContext: TRACE_CONTEXT
    });

    expect(result.tools).toEqual(expect.arrayContaining(['portfolio_analysis']));
    expect(result.tools).not.toContain('fact_check');
  });

  it('routes explicit combined fact+compliance intent to fact_compliance_check', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'finance',
      mode: 'tool_call',
      tool: 'none'
    });
    const llm = createLlmMock({ reasonAboutQuery });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'Please verify the BTC price and run a compliance check on this recommendation',
      traceContext: TRACE_CONTEXT
    });

    expect(result.tools).toContain('fact_compliance_check');
    expect(result.tools).not.toContain('compliance_check');
  });

  it('bypasses reasonAboutQuery for clear portfolio retrieval prompts', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'general',
      mode: 'direct_reply',
      tool: 'none'
    });
    const llm = createLlmMock({ reasonAboutQuery });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'analyze my portfolio performance and allocation',
      traceContext: TRACE_CONTEXT
    });

    expect(reasonAboutQuery).not.toHaveBeenCalled();
    expect(result.tools).toEqual(expect.arrayContaining(['portfolio_analysis']));
  });

  it('bypasses reasonAboutQuery for clear transaction-history retrieval prompts', async () => {
    const reasonAboutQuery = jest.fn().mockResolvedValue({
      intent: 'general',
      mode: 'direct_reply',
      tool: 'none'
    });
    const llm = createLlmMock({ reasonAboutQuery });

    const result = await decideRoute({
      conversation: [] as AgentConversationMessage[],
      llm,
      message: 'what did i buy last year',
      traceContext: TRACE_CONTEXT
    });

    expect(reasonAboutQuery).not.toHaveBeenCalled();
    expect(result.tools).toEqual(expect.arrayContaining(['transaction_timeline']));
  });
});
