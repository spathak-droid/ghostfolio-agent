import { AgentService } from './agent.service';

describe('AgentService', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.AGENT_SERVICE_URL = 'http://localhost:4444';
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('forwards payload and authorization header to standalone agent service', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        answer: 'Portfolio analysis: Diversified.',
        conversation: [
          { content: 'Analyze my portfolio allocation', role: 'user' },
          { content: 'Portfolio analysis: Diversified.', role: 'assistant' }
        ],
        errors: [],
        toolCalls: [
          {
            toolName: 'portfolio_analysis',
            success: true,
            result: { summary: 'Diversified' }
          }
        ],
        verification: {
          confidence: 0.82,
          isValid: true
        }
      }),
      ok: true
    });

    const service = new AgentService();

    const result = await service.chat(
      {
        conversationId: 'conv-1',
        message: 'Analyze my portfolio allocation'
      },
      'Bearer jwt-token'
    );

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4444/chat', {
      body: JSON.stringify({
        conversationId: 'conv-1',
        message: 'Analyze my portfolio allocation'
      }),
      headers: {
        Authorization: 'Bearer jwt-token',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });

    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'portfolio_analysis'
        })
      ])
    );
  });

  it('returns graceful recoverable error when standalone agent is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const service = new AgentService();

    const result = await service.chat({
      conversationId: 'conv-2',
      message: 'Get market data for AAPL'
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TOOL_EXECUTION_FAILED',
          recoverable: true
        })
      ])
    );
    expect(result.answer).toContain('could not complete');
    expect(result.verification.isValid).toBe(false);
  });

  it('proxies widget asset payload and content type', async () => {
    fetchMock.mockResolvedValue({
      arrayBuffer: async () =>
        new TextEncoder().encode('console.log("widget");').buffer,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'content-type') {
            return 'text/javascript; charset=utf-8';
          }

          return null;
        }
      },
      status: 200
    });

    const service = new AgentService();

    const result = await service.fetchWidgetAsset('index.js');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4444/widget/index.js');
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('text/javascript; charset=utf-8');
    expect(result.body.toString('utf8')).toContain('widget');
  });

  it('forwards feedback payload to standalone agent service', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true
    });

    const service = new AgentService();
    const result = await service.feedback(
      {
        answer: 'Assistant answer',
        conversationId: 'conv-1',
        rating: 'down'
      },
      'Bearer jwt-token'
    );

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4444/feedback', {
      body: JSON.stringify({
        answer: 'Assistant answer',
        conversationId: 'conv-1',
        rating: 'down'
      }),
      headers: {
        Authorization: 'Bearer jwt-token',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });
    expect(result).toEqual({ ok: true });
  });

  it('surfaces feedback upstream failure status and payload', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ code: 'FEEDBACK_PERSIST_FAILED' }),
      ok: false,
      status: 503
    });

    const service = new AgentService();

    await expect(
      service.feedback({
        answer: 'Assistant answer',
        conversationId: 'conv-1',
        rating: 'down'
      })
    ).rejects.toMatchObject({
      response: { code: 'FEEDBACK_PERSIST_FAILED' },
      status: 503
    });
  });

  it('uses http for *.railway.internal so internal TLS does not fail', async () => {
    process.env.AGENT_SERVICE_URL = 'https://confident-acceptance.railway.internal:4444';
    fetchMock.mockResolvedValue({
      json: async () => ({
        answer: 'ok',
        conversation: [],
        errors: [],
        toolCalls: [],
        verification: { confidence: 0, isValid: true }
      }),
      ok: true
    });

    const service = new AgentService();
    await service.chat({
      conversationId: 'c',
      message: 'hi'
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://confident-acceptance.railway.internal:4444/chat',
      expect.any(Object)
    );
  });
});
