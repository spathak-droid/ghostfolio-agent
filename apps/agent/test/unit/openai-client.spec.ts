import { createOpenAiClient } from '../../server/openai-client';

describe('openai client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('selects a tool from OpenAI JSON output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"tool":"portfolio_analysis"}'
            }
          }
        ]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.selectTool('Analyze my portfolio', []);

    expect(result.tool).toBe('portfolio_analysis');
  });

  it('returns none when API call fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.selectTool('Hello', []);

    expect(result.tool).toBe('none');
  });

  it('returns greeting fallback when answer content is empty for hello', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: undefined
            }
          }
        ]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.answerFinanceQuestion('hello', []);

    expect(result.toLowerCase()).toContain('hi');
    expect(result.toLowerCase()).toContain('portfolio');
  });

  it('normalizes greeting answers to include help capability text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Hello there!'
            }
          }
        ]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.answerFinanceQuestion('hello', []);

    expect(result.toLowerCase()).toContain('help');
    expect(result.toLowerCase()).toContain('portfolio');
  });

  it('returns finance joke fallback when model returns empty', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: undefined
            }
          }
        ]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.answerFinanceQuestion('tell me a finance joke', []);

    expect(result.toLowerCase()).toContain('finance joke');
  });

  it('returns reasoning decision for routing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"intent":"finance","mode":"tool_call","tool":"market_data_lookup","rationale":"needs live price"}'
            }
          }
        ]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.reasonAboutQuery?.('what is aapl price', []);

    expect(result).toEqual(
      expect.objectContaining({
        intent: 'finance',
        mode: 'tool_call',
        tool: 'market_data_lookup'
      })
    );
  });

  it('parses non-string content arrays returned by chat completions', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: [{ text: 'Here is a finance joke: ' }, { text: 'I lost money on paper, so I switched to digital losses.' }]
            }
          }
        ]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      model: 'gpt-4o-mini'
    });

    const result = await client.answerFinanceQuestion('tell me a finance joke', []);

    expect(result).toContain('finance joke');
    expect(result).toContain('digital losses');
  });
});
