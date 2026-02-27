import { createOpenAiClient, createOpenAiClientFromEnv } from '../../server/openai-client';

describe('openai client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_URL;
    delete process.env.API_KEY_OPENROUTER;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
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

  it('returns cached selectTool result without calling LLM', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ tool: 'portfolio_analysis' })),
      set: jest.fn()
    };
    global.fetch = jest.fn();

    const client = createOpenAiClient({
      apiKey: 'test-key',
      cache,
      model: 'gpt-4o-mini'
    });

    const result = await client.selectTool('Analyze my portfolio', []);

    expect(result.tool).toBe('portfolio_analysis');
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('caches selectTool result on cache miss', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined)
    };
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: '{"tool":"market_data_lookup"}' } }]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClient({
      apiKey: 'test-key',
      cache,
      cacheTtlSeconds: {
        selectTool: 33
      },
      model: 'gpt-4o-mini'
    });

    const result = await client.selectTool('what is tsla price', []);

    expect(result.tool).toBe('market_data_lookup');
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('llm_cache:select_tool:'),
      JSON.stringify({ tool: 'market_data_lookup' }),
      33
    );
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

  it('forces finance-only direct reply for non-finance meta prompts', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: 'I am a large language model, trained by Google.'
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

    const result = await client.answerFinanceQuestion('which llm do you use?', []);

    expect(result.toLowerCase()).toContain('portfolio');
    expect(result.toLowerCase()).not.toContain('trained by google');
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

  it('prefers OpenRouter env config when OPENROUTER_API_KEY is set', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENROUTER_MODEL = 'openai/gpt-5-nano';

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: '{"tool":"portfolio_analysis"}' } }]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClientFromEnv();
    const result = await client?.selectTool('Analyze my portfolio', []);

    expect(result?.tool).toBe('portfolio_analysis');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"openai/gpt-5-nano"')
      })
    );
  });

  it('uses OpenAI model fallback automatically without extra env configuration', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENROUTER_MODEL = 'google/gemini-2.5-flash';

    const chatBodies: string[] = [];
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/chat/completions')) {
        chatBodies.push(String(init?.body ?? ''));
        const isFirstChatCall = chatBodies.length === 1;
        return Promise.resolve({
          json: async () => ({
            choices: [
              {
                message: {
                  content: isFirstChatCall
                    ? '{"tool":"transaction_categorize"}'
                    : '## Direct Answer\n- buy/sell ratio: 4.33'
                }
              }
            ]
          }),
          ok: true
        }) as Promise<Response>;
      }

      return Promise.resolve({
        json: async () => ({}),
        ok: true
      }) as Promise<Response>;
    }) as unknown as typeof fetch;

    const client = createOpenAiClientFromEnv();
    await client?.selectTool('what is my buy sell ratio', []);

    expect(chatBodies[0]).toContain('"model":"google/gemini-2.5-flash"');
  });

  it('falls back to default OpenRouter URL when OPENROUTER_URL is blank', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENROUTER_MODEL = 'openai/gpt-5-nano';
    process.env.OPENROUTER_URL = '   ';

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: '{"tool":"portfolio_analysis"}' } }]
      }),
      ok: true
    }) as unknown as typeof fetch;

    const client = createOpenAiClientFromEnv();
    await client?.selectTool('Analyze my portfolio', []);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.anything()
    );
  });

  it('extracts partial create_order params from follow-up quantity with comma format', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"quantity":"50,000"}'
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

    const result = await client.getToolParametersForOrder?.(
      '50,000',
      [
        { role: 'assistant', content: 'How many shares of SOL-USD do you want to buy?' },
        { role: 'user', content: 'solana' }
      ],
      'create_order'
    );

    expect(result).toEqual(
      expect.objectContaining({
        quantity: 50000
      })
    );
  });

  it('extracts structured compliance facts via JSON response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"concentration_risk":true,"constraints":false,"horizon":false,"is_recommendation":true,"quote_is_fresh":null,"quote_staleness_check":false,"replacement_buy_signal":false,"realized_pnl":"LOSS","risk_tolerance":false,"transaction_type":"BUY"}'
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

    const result = await client.extractComplianceFacts?.('Should I put all my money in BTC?');

    expect(result).toEqual(
      expect.objectContaining({
        concentration_risk: true,
        is_recommendation: true,
        realized_pnl: 'LOSS',
        transaction_type: 'BUY'
      })
    );
  });

  it('returns cached compliance facts without calling LLM', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(
        JSON.stringify({
          concentration_risk: true,
          is_recommendation: true
        })
      ),
      set: jest.fn()
    };
    global.fetch = jest.fn();

    const client = createOpenAiClient({
      apiKey: 'test-key',
      cache,
      model: 'gpt-4o-mini'
    });

    const result = await client.extractComplianceFacts?.(
      'Should I put all my money into one stock?'
    );

    expect(result).toEqual(
      expect.objectContaining({
        concentration_risk: true,
        is_recommendation: true
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns undefined compliance facts for non-JSON model output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: 'not json'
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

    const result = await client.extractComplianceFacts?.('check compliance');
    expect(result).toBeUndefined();
  });
});
