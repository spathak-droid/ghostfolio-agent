import { createAgent } from '../../server/agent';
import type { AgentContextManager } from '../../server/context-manager';
import type { AgentConversationStore, AgentWorkflowState } from '../../server/conversation-store';
import type { AgentConversationMessage } from '../../server/types';

function createNoopTools() {
  return {
    complianceCheck: jest.fn().mockResolvedValue({}),
    createOrder: jest.fn().mockResolvedValue({}),
    getOrders: jest.fn().mockResolvedValue({}),
    getTransactions: jest.fn().mockResolvedValue({}),
    marketData: jest.fn().mockResolvedValue({}),
    marketDataLookup: jest.fn().mockResolvedValue({}),
    portfolioAnalysis: jest.fn().mockResolvedValue({}),
    transactionCategorize: jest.fn().mockResolvedValue({}),
    transactionTimeline: jest.fn().mockResolvedValue({})
  };
}

describe('agent conversation persistence', () => {
  it('loads conversation/state from store and persists updates', async () => {
    const existingConversation: AgentConversationMessage[] = [
      { content: 'past user message', role: 'user' },
      { content: 'past assistant message', role: 'assistant' }
    ];
    const existingState: AgentWorkflowState = {
      pendingAction: 'idle',
      pinnedFacts: ['Portfolio base currency USD'],
      updatedAt: '2026-02-25T00:00:00.000Z',
      verificationFlags: []
    };

    const store: AgentConversationStore = {
      getConversation: jest.fn().mockResolvedValue(existingConversation),
      getState: jest.fn().mockResolvedValue(existingState),
      setConversation: jest.fn().mockResolvedValue(undefined),
      setState: jest.fn().mockResolvedValue(undefined)
    };

    const contextManager: AgentContextManager = {
      buildContext: jest.fn().mockReturnValue([
        { content: 'managed context', role: 'assistant' }
      ])
    };

    const answerFinanceQuestion = jest.fn().mockResolvedValue('hello from llm');

    const agent = createAgent({
      contextManager,
      conversationStore: store,
      llm: {
        answerFinanceQuestion,
        reasonAboutQuery: jest.fn().mockResolvedValue({
          intent: 'general',
          mode: 'direct_reply',
          tool: 'none'
        }),
        selectTool: jest.fn().mockResolvedValue({
          tool: 'none'
        })
      },
      tools: createNoopTools()
    });

    const response = await agent.chat({
      conversationId: 'conv-persist-1',
      message: 'hello'
    });

    expect(contextManager.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: [...existingConversation, { content: 'hello', role: 'user' }],
        state: existingState
      })
    );
    expect(answerFinanceQuestion).toHaveBeenCalledWith(
      'hello',
      [{ content: 'managed context', role: 'assistant' }],
      expect.any(Object)
    );
    expect(store.setConversation).toHaveBeenCalledWith(
      'conv-persist-1',
      response.conversation
    );
    expect(store.setState).toHaveBeenCalledWith(
      'conv-persist-1',
      expect.objectContaining({
        pendingAction: 'idle',
        verificationFlags: response.verification.flags
      })
    );
  });
});
