import { createDefaultContextManager } from '../../server/context-manager';
import type { AgentConversationMessage } from '../../server/types';

describe('context manager', () => {
  it('adds summary and pinned facts while keeping recent messages', () => {
    const contextManager = createDefaultContextManager({
      maxRecentMessages: 4,
      summarySampleMessages: 4
    });
    const conversation: AgentConversationMessage[] = [
      { content: 'user one', role: 'user' },
      { content: 'assistant one', role: 'assistant' },
      { content: 'user two', role: 'user' },
      { content: 'assistant two', role: 'assistant' },
      { content: 'user three', role: 'user' },
      { content: 'assistant three', role: 'assistant' },
      { content: 'user four', role: 'user' },
      { content: 'assistant four', role: 'assistant' }
    ];

    const managed = contextManager.buildContext({
      conversation,
      state: {
        pendingAction: 'awaiting_clarification',
        pendingTool: 'create_order',
        pinnedFacts: ['Pending order symbol AAPL', 'Missing quantity'],
        updatedAt: '2026-02-25T00:00:00.000Z',
        verificationFlags: []
      }
    });

    expect(managed.length).toBeGreaterThanOrEqual(6);
    expect(managed[0].role).toBe('assistant');
    expect(managed[0].content).toContain('Context summary');
    expect(managed[1].role).toBe('assistant');
    expect(managed[1].content).toContain('Pinned context');
    expect(managed.slice(-4)).toEqual(conversation.slice(-4));
  });

  it('returns full conversation when under the recent-message limit', () => {
    const contextManager = createDefaultContextManager({
      maxRecentMessages: 8
    });
    const conversation: AgentConversationMessage[] = [
      { content: 'hello', role: 'user' },
      { content: 'hi', role: 'assistant' }
    ];

    const managed = contextManager.buildContext({ conversation });

    expect(managed).toEqual(conversation);
  });
});
