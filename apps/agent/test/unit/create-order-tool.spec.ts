import { createOrderTool } from '../../server/tools/create-order';

describe('createOrderTool', () => {
  it('asks only for type when symbol is already provided', async () => {
    const client = {
      createOrder: jest.fn(),
      getSymbolData: jest.fn(),
      getSymbolLookup: jest.fn(),
      getUser: jest.fn()
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        symbol: 'SOL-USD'
      } as never,
      message: 'solana'
    });

    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true,
        success: true
      })
    );
    expect(result.missingFields).toEqual(['type']);
    expect(String(result.answer)).toContain('buy or a sell');
  });

  it('asks only for symbol when type is already provided', async () => {
    const client = {
      createOrder: jest.fn(),
      getSymbolData: jest.fn(),
      getSymbolLookup: jest.fn(),
      getUser: jest.fn()
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        type: 'BUY'
      } as never,
      message: 'buy'
    });

    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true,
        success: true
      })
    );
    expect(result.missingFields).toEqual(['symbol']);
    expect(String(result.answer)).toContain('Which symbol');
  });

  it('asks for account selection when accountId is missing and user has multiple accounts', async () => {
    const client = {
      createOrder: jest.fn(),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 200,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [
          { id: 'acc-1', name: 'Brokerage' },
          { id: 'acc-2', name: 'Retirement' }
        ],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 1,
        symbol: 'TSLA',
        type: 'BUY'
      },
      message: 'buy tesla'
    });

    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true,
        success: true
      })
    );
    expect(result.missingFields).toEqual(expect.arrayContaining(['accountId']));
    expect(String(result.answer)).toContain('Please choose an account');
    expect(String(result.answer)).toContain('Brokerage');
    expect(String(result.answer).toLowerCase()).toContain('which one');
    expect(String(result.answer).toLowerCase()).not.toContain('account id');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('accepts account name selection and maps it to account id internally', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-name-1' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'order-name-1' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'acc-1': {
            balance: 100000,
            currency: 'USD',
            name: 'Brokerage'
          }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 120,
        symbol: 'AAPL'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [
          { id: 'acc-1', name: 'Brokerage' },
          { id: 'acc-2', name: 'Retirement' }
        ],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        accountId: 'Brokerage',
        quantity: 1,
        symbol: 'AAPL',
        type: 'BUY'
      },
      message: 'buy 1 aapl in brokerage'
    });

    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        symbol: 'AAPL',
        type: 'BUY'
      }),
      expect.anything()
    );
    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-name-1');
  });

  it('uses the only available account when accountId is not provided', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'order-1' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'acc-main': {
            balance: 100000,
            currency: 'USD',
            name: 'Main Account'
          }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 150,
        symbol: 'AAPL'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'AAPL',
        type: 'BUY'
      },
      message: 'buy apple'
    });

    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-main',
        symbol: 'AAPL',
        type: 'BUY'
      }),
      expect.anything()
    );
    expect(client.getPortfolioSummary).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-1');
  });

  it('does not ask for currency for SELL when market data provides currency', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-sell-1' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'order-sell-1' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: {
          TSLA: { quantity: 10, symbol: 'TSLA' }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 417.4,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'EUR' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      },
      message: 'sell 2 tsla'
    });

    expect(result.success).toBe(true);
    expect(result.needsClarification).toBeUndefined();
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      }),
      expect.anything()
    );
    expect(client.getPortfolioSummary).toHaveBeenCalled();
    const summaryCallOrder = (client.getPortfolioSummary as jest.Mock).mock.invocationCallOrder[0];
    const createCallOrder = (client.createOrder as jest.Mock).mock.invocationCallOrder[0];
    expect(summaryCallOrder).toBeLessThan(createCallOrder);
  });

  it('blocks SELL when requested quantity exceeds current holdings', async () => {
    const client = {
      createOrder: jest.fn(),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: {
          TSLA: { quantity: 1, symbol: 'TSLA' }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 417.4,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      },
      message: 'sell 2 tsla'
    });

    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true,
        success: true
      })
    );
    expect(result.missingFields).toEqual(expect.arrayContaining(['quantity']));
    expect(String(result.summary)).toContain('Insufficient holdings for SELL order');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('prefers canonical BTC price source before noisy lookup candidates', async () => {
    const client = {
      createOrder: jest.fn(),
      getSymbolData: jest
        .fn()
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce({
          currency: 'USD',
          dataSource: 'COINGECKO',
          marketPrice: 65000,
          symbol: 'bitcoin'
        }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'COINGECKO', symbol: '1rus-btc25' }]
      }),
      getUser: jest.fn()
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        symbol: 'BTC',
        type: 'BUY'
      },
      message: 'buy btc'
    });

    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true,
        success: true
      })
    );
    expect(String(result.answer)).toContain('65000');
    expect(client.getSymbolData).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dataSource: 'YAHOO',
        symbol: 'BTC-USD'
      })
    );
    expect(client.getSymbolData).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        dataSource: 'COINGECKO',
        symbol: 'bitcoin'
      })
    );
  });

  it('blocks BUY order when estimated cost exceeds selected account cash balance', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-2' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'acc-main': {
            balance: 1000,
            currency: 'USD',
            name: 'Main Account'
          }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 300,
        symbol: 'AAPL'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 10,
        symbol: 'AAPL',
        type: 'BUY'
      },
      message: 'buy 10 AAPL'
    });

    expect(result.success).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true
      })
    );
    expect(result.missingFields).toEqual(expect.arrayContaining(['quantity']));
    expect(String(result.summary)).toContain('Insufficient account balance');
    expect(String(result.answer)).toContain('Estimated cost');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('blocks USD orders above the hard transaction cap', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-3' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'acc-main': {
            balance: 1000000,
            currency: 'USD',
            name: 'Main Account'
          }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 200,
        symbol: 'AAPL'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 600,
        symbol: 'AAPL',
        type: 'BUY'
      },
      message: 'buy 600 AAPL'
    });

    expect(result.success).toBe(true);
    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true
      })
    );
    expect(result.missingFields).toEqual(expect.arrayContaining(['quantity']));
    expect(String(result.summary)).toContain('Transaction amount exceeds hard limit');
    expect(String(result.answer)).toContain('USD 100000');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('returns top symbol options when lookup is ambiguous', async () => {
    const client = {
      createOrder: jest.fn(),
      getSymbolData: jest.fn(),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [
          { dataSource: 'YAHOO', symbol: 'SOLALAUSD', name: 'Solala USD' },
          { dataSource: 'YAHOO', symbol: 'SOL-USD', name: 'Solana USD' },
          { dataSource: 'COINGECKO', symbol: 'solana', name: 'Solana' }
        ]
      }),
      getUser: jest.fn()
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        symbol: 'sola',
        type: 'BUY'
      },
      message: 'buy sola'
    });

    expect(result).toEqual(
      expect.objectContaining({
        needsClarification: true,
        success: true
      })
    );
    expect(result.missingFields).toEqual(expect.arrayContaining(['symbol']));
    expect(result.symbolOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'SOL-USD' })
      ])
    );
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('uses provided symbol and dataSource directly when selected from options', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-4' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'order-4' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'acc-main': {
            balance: 100000,
            currency: 'USD',
            name: 'Main Account'
          }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 90,
        symbol: 'SOLUSD'
      }),
      getSymbolLookup: jest.fn(),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        dataSource: 'YAHOO',
        quantity: 2,
        symbol: 'SOLUSD',
        type: 'BUY'
      },
      message: 'SOLUSD'
    });

    expect(client.getSymbolLookup).not.toHaveBeenCalled();
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: 'YAHOO',
        symbol: 'SOLUSD',
        type: 'BUY'
      }),
      expect.anything()
    );
    expect(client.getPortfolioSummary).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('fails when required holdings/balance snapshot API call fails', async () => {
    const client = {
      createOrder: jest.fn(),
      getPortfolioSummary: jest.fn().mockRejectedValue(new Error('network down')),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 417.4,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      },
      message: 'sell 2 tsla'
    });

    expect(result.success).toBe(false);
    expect(String(result.summary)).toContain('Ghostfolio API failure');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('fails when createOrder API response is missing order id', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({}),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: {
          TSLA: { quantity: 10, symbol: 'TSLA' }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 417.4,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      },
      message: 'sell 2 tsla'
    });

    expect(result.success).toBe(false);
    expect(String(result.summary)).toContain('missing order id');
  });

  it('fails when created order cannot be verified by id lookup', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-verify-fail' }),
      getOrderById: jest.fn().mockRejectedValue(new Error('404 Not Found')),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: {
          TSLA: { quantity: 10, symbol: 'TSLA' }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 417.4,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      },
      message: 'sell 2 tsla'
    });

    expect(client.createOrder).toHaveBeenCalled();
    expect(client.getOrderById).toHaveBeenCalledWith('order-verify-fail', expect.anything());
    expect(result.success).toBe(false);
    expect(String(result.summary)).toContain('post-check');
  });

  it('uses runtime today date when message says today even if extracted date is stale', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-date-1' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'order-date-1' }),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        holdings: {
          TSLA: { quantity: 10, symbol: 'TSLA' }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 417.4,
        symbol: 'TSLA'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'TSLA' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const before = Date.now();
    await createOrderTool({
      client: client as never,
      createOrderParams: {
        date: '2024-06-05',
        quantity: 2,
        symbol: 'TSLA',
        type: 'SELL'
      },
      message: 'sell 2 tsla today'
    });
    const after = Date.now();

    const callArgs = client.createOrder.mock.calls[0]?.[0] as { date?: string };
    expect(typeof callArgs.date).toBe('string');
    const resolved = new Date(String(callArgs.date)).getTime();
    expect(resolved).toBeGreaterThanOrEqual(before - 1000);
    expect(resolved).toBeLessThanOrEqual(after + 1000);
  });

  it('returns structured error payload when createOrder fails', async () => {
    const client = {
      createOrder: jest.fn().mockRejectedValue(new Error('Ghostfolio API request failed: 500')),
      getPortfolioSummary: jest.fn().mockResolvedValue({
        accounts: {
          'acc-main': { balance: 100000, currency: 'USD', name: 'Main Account' }
        }
      }),
      getSymbolData: jest.fn().mockResolvedValue({
        currency: 'USD',
        dataSource: 'YAHOO',
        marketPrice: 150,
        symbol: 'AAPL'
      }),
      getSymbolLookup: jest.fn().mockResolvedValue({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }]
      }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOrderTool({
      client: client as never,
      createOrderParams: {
        quantity: 2,
        symbol: 'AAPL',
        type: 'BUY'
      },
      message: 'buy apple'
    });

    expect(result.success).toBe(false);
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          error_code: 'TOOL_EXECUTION_FAILED',
          retryable: true
        })
      })
    );
  });
});
