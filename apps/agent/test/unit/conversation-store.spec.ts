import {
  createInMemoryConversationStore,
  type AgentConversationStore,
  type AgentWorkflowState
} from '../../server/stores';
import type { AgentConversationMessage } from '../../server/types';

describe('conversation store', () => {
  it('stores and retrieves conversation history', async () => {
    const store = createInMemoryConversationStore();
    const conversationId = 'conv-store-1';
    const conversation: AgentConversationMessage[] = [
      { content: 'hello', role: 'user' },
      { content: 'hi there', role: 'assistant' }
    ];

    await store.setConversation(conversationId, conversation);
    const restored = await store.getConversation(conversationId);

    expect(restored).toEqual(conversation);
  });

  it('stores and retrieves workflow state', async () => {
    const store: AgentConversationStore = createInMemoryConversationStore();
    const conversationId = 'conv-store-2';
    const state: AgentWorkflowState = {
      lastTool: 'create_order',
      missingFields: ['quantity'],
      pendingAction: 'awaiting_clarification',
      pendingTool: 'create_order',
      pinnedFacts: ['Pending BUY order for AAPL'],
      updatedAt: '2026-02-25T00:00:00.000Z',
      verificationFlags: []
    };

    await store.setState(conversationId, state);
    const restored = await store.getState(conversationId);

    expect(restored).toEqual(state);
  });

  it('clearConversation removes messages and state', async () => {
    const store = createInMemoryConversationStore();
    const conversationId = 'conv-store-clear';
    const conversation: AgentConversationMessage[] = [
      { content: 'hi', role: 'user' },
      { content: 'hello', role: 'assistant' }
    ];
    const state: AgentWorkflowState = {
      lastTool: 'market_data',
      pendingAction: 'idle',
      updatedAt: new Date().toISOString(),
      verificationFlags: []
    };
    await store.setConversation(conversationId, conversation);
    await store.setState(conversationId, state);
    await store.clearConversation(conversationId);
    const restoredConv = await store.getConversation(conversationId);
    const restoredState = await store.getState(conversationId);
    expect(restoredConv).toEqual([]);
    expect(restoredState).toBeUndefined();
  });
});
