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
});
