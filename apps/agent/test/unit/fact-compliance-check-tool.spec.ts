import { factCheckTool } from '../../server/tools/fact-check';
import { complianceCheckTool } from '../../server/tools/compliance-check';
import { factComplianceCheckTool } from '../../server/tools/fact-compliance-check';
import type { RegulationStore } from '../../server/regulation-store';

jest.mock('../../server/tools/fact-check');
jest.mock('../../server/tools/compliance-check');

const mockedFactCheckTool = jest.mocked(factCheckTool);
const mockedComplianceCheckTool = jest.mocked(complianceCheckTool);

function createRegulationStoreMock(): RegulationStore {
  return {
    getTextsByTopicId: jest.fn().mockResolvedValue([]),
    getTopic: jest.fn().mockResolvedValue(null),
    insertRegulationText: jest.fn().mockResolvedValue({ id: 'txt-1' }),
    listTopics: jest.fn().mockResolvedValue([]),
    seedTopics: jest.fn().mockResolvedValue({ seeded: 0 })
  };
}

describe('factComplianceCheckTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns nested fact_check and compliance_check sections with merged metadata', async () => {
    mockedFactCheckTool.mockResolvedValue({
      data_as_of: '2026-02-27T00:00:00.000Z',
      match: true,
      sources: ['ghostfolio_api', 'coingecko'],
      summary: 'Fact check ok'
    });
    mockedComplianceCheckTool.mockResolvedValue({
      answer: 'Compliance ok',
      data_as_of: '2026-02-26',
      isCompliant: true,
      policyVersion: 'us-baseline-v1',
      success: true,
      sources: ['policy_pack:us-baseline-v1'],
      summary: 'Compliance ok',
      violations: [],
      warnings: []
    });

    const result = await factComplianceCheckTool({
      client: {} as never,
      message: 'verify and check compliance'
    });

    expect(result.fact_check).toEqual(expect.objectContaining({ match: true }));
    expect(result.compliance_check).toEqual(expect.objectContaining({ isCompliant: true }));
    expect(result.sources).toEqual(
      expect.arrayContaining(['ghostfolio_api', 'coingecko', 'policy_pack:us-baseline-v1'])
    );
    expect(result.data_as_of).toBe('2026-02-27T00:00:00.000Z');
  });

  it('attaches regulation excerpts when rule_id maps to stored topic text', async () => {
    const store = createRegulationStoreMock();
    const listTopics = jest.mocked(store.listTopics);
    const getTextsByTopicId = jest.mocked(store.getTextsByTopicId);
    listTopics.mockResolvedValue([
      {
        created_at: new Date('2026-02-01T00:00:00.000Z'),
        id: 'wash-sale',
        key_references: ['https://www.irs.gov/publications/p550'],
        name: 'Wash Sale Rule',
        rule_id: 'R-IRS-WASH-SALE',
        source: 'IRS',
        updated_at: new Date('2026-02-01T00:00:00.000Z')
      }
    ]);
    getTextsByTopicId.mockResolvedValue([
      {
        chunk_index: 0,
        content: 'This is a long excerpt from regulation text for wash sale treatment.'.repeat(10),
        created_at: new Date('2026-02-02T00:00:00.000Z'),
        fetched_at: new Date('2026-02-02T00:00:00.000Z'),
        id: 'text-1',
        source_url: 'https://www.irs.gov/publications/p550',
        topic_id: 'wash-sale'
      }
    ]);

    mockedFactCheckTool.mockResolvedValue({
      data_as_of: '2026-02-27T00:00:00.000Z',
      match: true,
      sources: ['ghostfolio_api']
    });
    mockedComplianceCheckTool.mockResolvedValue({
      answer: 'Compliance ok',
      data_as_of: '2026-02-26',
      isCompliant: true,
      policyVersion: 'us-baseline-v1',
      success: true,
      sources: ['policy_pack:us-baseline-v1'],
      summary: 'Compliance ok',
      violations: [],
      warnings: [{ message: 'Potential wash sale', rule_id: 'R-IRS-WASH-SALE', severity: 'warning' }]
    });

    const result = await factComplianceCheckTool({
      client: {} as never,
      message: 'verify and check compliance',
      regulationStore: store
    });

    const warnings = (result.compliance_check as Record<string, unknown>).warnings as Record<string, unknown>[];
    expect(warnings[0]?.regulation_excerpt).toEqual(
      expect.objectContaining({
        topic_id: 'wash-sale'
      })
    );
  });

  it('adds regulation_text_unavailable metadata note when excerpts are unavailable', async () => {
    const store = createRegulationStoreMock();
    mockedFactCheckTool.mockResolvedValue({
      data_as_of: '2026-02-27T00:00:00.000Z',
      match: true,
      sources: ['ghostfolio_api']
    });
    mockedComplianceCheckTool.mockResolvedValue({
      answer: 'Compliance failed',
      data_as_of: '2026-02-26',
      isCompliant: false,
      policyVersion: 'us-baseline-v1',
      success: true,
      sources: ['policy_pack:us-baseline-v1'],
      summary: 'Compliance failed',
      violations: [{ message: 'Suitability missing', rule_id: 'R-FINRA-2111', severity: 'violation' }],
      warnings: []
    });

    const result = await factComplianceCheckTool({
      client: {} as never,
      message: 'verify and check compliance',
      regulationStore: store
    });

    expect((result.compliance_check as Record<string, unknown>).regulation_text_status).toBe(
      'regulation_text_unavailable'
    );
  });
});
