import {
  createFeedbackStoreForTest,
  createFeedbackStoreFromEnv
} from '../../server/stores';

describe('feedback-store', () => {
  it('persists feedback after creating table/indexes', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const query = jest.fn().mockResolvedValue([]);
    const store = createFeedbackStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });

    const result = await store.save({
      answer: 'answer text',
      conversationId: 'conv-1',
      message: 'user message',
      rating: 'up'
    });

    expect(result.ok).toBe(true);
    expect(result.feedbackId).toBeDefined();
    expect(execute).toHaveBeenCalled();
    expect(execute.mock.calls.some((call) => String(call[0]).includes('CREATE TABLE IF NOT EXISTS agent_feedback'))).toBe(true);
    expect(execute.mock.calls.some((call) => String(call[0]).includes('INSERT INTO agent_feedback'))).toBe(true);
  });

  it('returns feedback memory hints for similar prior failures', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const query = jest.fn().mockResolvedValue([
      {
        answer: 'Too generic.',
        correction: 'Include holdings and cash totals.',
        trace_json: [{ type: 'llm', name: 'synthesize' }]
      }
    ]);
    const store = createFeedbackStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });

    const memory = await store.getForToolSignature('portfolio_analysis');

    expect(memory).toBeDefined();
    expect(memory?.do[0]).toContain('Include holdings and cash totals');
    expect(query).toHaveBeenCalled();
  });

  it('returns disabled error when db url is missing', async () => {
    const prevAgentUrl = process.env.AGENT_FEEDBACK_DATABASE_URL;
    const prevDbUrl = process.env.DATABASE_URL;
    delete process.env.AGENT_FEEDBACK_DATABASE_URL;
    delete process.env.DATABASE_URL;

    const store = createFeedbackStoreFromEnv();
    const result = await store.save({
      answer: 'answer text',
      conversationId: 'conv-1',
      rating: 'down'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('database url');

    if (prevAgentUrl === undefined) {
      delete process.env.AGENT_FEEDBACK_DATABASE_URL;
    } else {
      process.env.AGENT_FEEDBACK_DATABASE_URL = prevAgentUrl;
    }
    if (prevDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prevDbUrl;
    }
  });
});
