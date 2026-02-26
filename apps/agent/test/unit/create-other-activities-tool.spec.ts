import { createOtherActivitiesTool } from '../../server/tools/create-other-activities';

describe('createOtherActivitiesTool', () => {
  it('asks for supported non-trade type when missing', async () => {
    const client = {
      createOrder: jest.fn(),
      getOrderById: jest.fn(),
      getUser: jest.fn()
    };

    const result = await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        symbol: 'AAPL'
      } as never,
      message: 'add activity'
    });

    expect(result.success).toBe(true);
    expect(result.needsClarification).toBe(true);
    expect(result.missingFields).toEqual(['type']);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('creates DIVIDEND activity and verifies created id', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'activity-1' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'activity-1' }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        symbol: 'AAPL',
        type: 'DIVIDEND',
        unitPrice: 10
      },
      message: 'record dividend for aapl'
    });

    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-main',
        currency: 'USD',
        quantity: 1,
        symbol: 'AAPL',
        type: 'DIVIDEND',
        unitPrice: 10
      }),
      expect.anything()
    );
    expect(client.getOrderById).toHaveBeenCalledWith('activity-1', expect.anything());
    expect(result.success).toBe(true);
    expect(result.orderId).toBe('activity-1');
  });

  it('does not accept BUY/SELL type in create_other_activities', async () => {
    const client = {
      createOrder: jest.fn(),
      getOrderById: jest.fn(),
      getUser: jest.fn()
    };

    const result = await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        symbol: 'TSLA',
        type: 'BUY',
        unitPrice: 100
      },
      message: 'buy tsla'
    });

    expect(result.success).toBe(true);
    expect(result.needsClarification).toBe(true);
    expect(result.missingFields).toEqual(['type']);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('uses runtime today date when message says today even if extracted date is stale', async () => {
    const client = {
      createOrder: jest.fn().mockResolvedValue({ id: 'activity-2' }),
      getOrderById: jest.fn().mockResolvedValue({ id: 'activity-2' }),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const before = Date.now();
    await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        date: '2024-06-05',
        symbol: 'MORTGAGE',
        type: 'LIABILITY',
        unitPrice: 10000
      },
      message: "add mortgage of 10000 and today's date"
    });
    const after = Date.now();

    const callArgs = client.createOrder.mock.calls[0]?.[0] as { date?: string };
    expect(typeof callArgs.date).toBe('string');
    const resolved = new Date(String(callArgs.date)).getTime();
    expect(resolved).toBeGreaterThanOrEqual(before - 1000);
    expect(resolved).toBeLessThanOrEqual(after + 1000);
  });

  it('does not require symbol for LIABILITY and asks amount next', async () => {
    const client = {
      createOrder: jest.fn(),
      getOrderById: jest.fn(),
      getUser: jest.fn()
    };

    const result = await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        type: 'LIABILITY'
      },
      message: 'add a liability'
    });

    expect(result.success).toBe(true);
    expect(result.needsClarification).toBe(true);
    expect(result.missingFields).toEqual(['unitPrice']);
    expect(String(result.answer).toLowerCase()).toContain('amount');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('normalizes DIVIDENT typo type and asks amount next', async () => {
    const client = {
      createOrder: jest.fn(),
      getOrderById: jest.fn(),
      getUser: jest.fn()
    };

    const result = await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        type: 'DIVIDENT' as never
      },
      message: 'add a divident'
    });

    expect(result.success).toBe(true);
    expect(result.needsClarification).toBe(true);
    expect(result.missingFields).toEqual(['unitPrice']);
    expect(String(result.answer).toLowerCase()).toContain('dividend');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('returns structured error payload when create activity fails', async () => {
    const client = {
      createOrder: jest.fn().mockRejectedValue(new Error('Ghostfolio API request failed: 500')),
      getOrderById: jest.fn(),
      getUser: jest.fn().mockResolvedValue({
        accounts: [{ id: 'acc-main', name: 'Main Account' }],
        settings: { settings: { baseCurrency: 'USD' } }
      })
    };

    const result = await createOtherActivitiesTool({
      client: client as never,
      createOrderParams: {
        symbol: 'AAPL',
        type: 'DIVIDEND',
        unitPrice: 10
      },
      message: 'record dividend for aapl'
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
