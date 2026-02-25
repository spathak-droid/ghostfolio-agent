import { updateOrderTool } from '../../server/tools/update-order';

describe('updateOrderTool', () => {
  it('blocks updates that exceed USD transaction cap', async () => {
    const client = {
      getOrderById: jest.fn().mockResolvedValue({
        SymbolProfile: {
          dataSource: 'YAHOO',
          symbol: 'AAPL'
        },
        currency: 'USD',
        date: '2026-02-01T00:00:00.000Z',
        fee: 0,
        quantity: 600,
        type: 'BUY',
        unitPrice: 200
      }),
      updateOrder: jest.fn()
    };

    const result = await updateOrderTool({
      client: client as never,
      updateOrderParams: {
        orderId: 'ord-123'
      },
      message: 'update order ord-123'
    });

    expect(result.success).toBe(false);
    expect(String(result.summary)).toContain('Transaction amount exceeds hard limit');
    expect(String(result.answer)).toContain('USD 100000');
    expect(client.updateOrder).not.toHaveBeenCalled();
  });
});
