import { SELECTABLE_TOOL_NAMES, TOOL_DEFINITIONS } from '../../server/tools/tool-registry';

describe('tool registry', () => {
  it('registers market_overview as a selectable tool', () => {
    const names = TOOL_DEFINITIONS.map(({ name }) => name);

    expect(names).toContain('market_overview');
    expect(SELECTABLE_TOOL_NAMES).toContain('market_overview');
    expect(names).toContain('compliance_check');
    expect(SELECTABLE_TOOL_NAMES).toContain('compliance_check');
  });
});
