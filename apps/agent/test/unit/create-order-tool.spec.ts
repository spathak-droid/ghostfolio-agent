import { createOrderTool } from '../../server/tools/create-order';

describe('createOrderTool', () => {
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
    expect(String(result.answer)).toContain('acc-1');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('uses the only available account when accountId is not provided', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
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
    expect(result.success).toBe(true);
    expect(result.orderId).toBe('order-1');
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

    expect(result.success).toBe(false);
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

    expect(result.success).toBe(false);
    expect(String(result.summary)).toContain('Transaction amount exceeds hard limit');
    expect(String(result.answer)).toContain('USD 100000');
    expect(client.createOrder).not.toHaveBeenCalled();
  });
});
