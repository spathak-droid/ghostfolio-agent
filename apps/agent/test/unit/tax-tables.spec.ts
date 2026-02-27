import { calculateTaxFromBrackets, loadFederalTaxTable } from '../../server/tax/tax-tables';

describe('tax tables', () => {
  it('loads the 2026 federal tax table', () => {
    const table = loadFederalTaxTable(2026);

    expect(table.taxYear).toBe(2026);
    expect(table.standardDeduction.single).toBe(16100);
    expect(table.longTermCapitalGainsBrackets.marriedFilingJointly[1]?.rate).toBe(0.15);
    expect(table.niit.rate).toBe(0.038);
  });

  it('calculates marginal tax from brackets', () => {
    const singleOrdinary = loadFederalTaxTable(2026).ordinaryBrackets.single;
    const tax = calculateTaxFromBrackets(50_000, singleOrdinary);

    // 12,400 @ 10% + 37,600 @ 12% = 1,240 + 4,512 = 5,752
    expect(tax).toBeCloseTo(5752, 6);
  });

  it('throws when tax table file is missing', () => {
    expect(() => loadFederalTaxTable(2099)).toThrow('tax table file not found');
  });
});
