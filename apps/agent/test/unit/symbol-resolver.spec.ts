import { resolveSymbol } from '../../server/tools/symbol-resolver';

describe('resolveSymbol', () => {
  it('resolves bitcoin alias to BTC-USD', async () => {
    const lookup = jest.fn().mockResolvedValue([]);

    const result = await resolveSymbol('bitcoin', lookup);

    expect(result).toEqual({
      dataSource: 'YAHOO',
      symbol: 'BTC-USD'
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});
