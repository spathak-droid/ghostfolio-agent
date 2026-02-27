import {
  createRegulationStoreForTest,
  createRegulationStoreFromEnv,
  DEFAULT_TOPICS
} from '../../server/regulation-store';

describe('regulation-store', () => {
  it('creates schema and seeds default topics', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const topicsRows = DEFAULT_TOPICS.map((t) => ({
      id: t.id,
      name: t.name,
      key_references: t.key_references,
      source: t.source,
      rule_id: t.rule_id,
      created_at: new Date(),
      updated_at: new Date()
    }));
    const query = jest.fn().mockResolvedValue(topicsRows);
    const store = createRegulationStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });

    const seedResult = await store.seedTopics();
    expect(seedResult.seeded).toBe(DEFAULT_TOPICS.length);
    expect(seedResult.error).toBeUndefined();
    expect(
      execute.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('CREATE TABLE IF NOT EXISTS regulation_topic')
      )
    ).toBe(true);
    expect(
      execute.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('INSERT INTO regulation_topic')
      )
    ).toBe(true);

    const topics = await store.listTopics();
    expect(topics.length).toBe(DEFAULT_TOPICS.length);
    expect(topics[0].id).toBe('wash-sale');
    expect(topics[0].rule_id).toBe('R-IRS-WASH-SALE');
  });

  it('getTopic returns null for empty id', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const query = jest.fn().mockResolvedValue([]);
    const store = createRegulationStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });

    expect(await store.getTopic('')).toBeNull();
    expect(await store.getTopic('   ')).toBeNull();
  });

  it('getTopic returns topic when found', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const row = {
      id: 'wash-sale',
      name: 'Wash Sale Rule',
      key_references: ['https://irs.gov/p550'],
      source: 'IRS',
      rule_id: 'R-IRS-WASH-SALE',
      created_at: new Date(),
      updated_at: new Date()
    };
    const query = jest.fn().mockResolvedValue([row]);
    const store = createRegulationStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });

    const topic = await store.getTopic('wash-sale');
    expect(topic).not.toBeNull();
    expect(topic?.id).toBe('wash-sale');
    expect(topic?.name).toBe('Wash Sale Rule');
    expect(topic?.key_references).toEqual(['https://irs.gov/p550']);
  });

  it('getTextsByTopicId returns empty when no texts', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const query = jest.fn().mockResolvedValue([]);
    const store = createRegulationStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });
    expect(await store.getTextsByTopicId('wash-sale')).toEqual([]);
  });

  it('insertRegulationText returns id on success', async () => {
    const execute = jest.fn().mockResolvedValue(1);
    const query = jest.fn().mockResolvedValue([{ id: 'abc-uuid' }]);
    const store = createRegulationStoreForTest({
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query
    });
    const result = await store.insertRegulationText({
      topic_id: 'wash-sale',
      source_url: 'https://irs.gov/p550',
      content: 'Some text'
    });
    expect(result).toEqual({ id: 'abc-uuid' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO regulation_text'),
      'wash-sale',
      'https://irs.gov/p550',
      'Some text',
      0
    );
  });

  it('returns disabled store when db url is missing', () => {
    const prevAgent = process.env.AGENT_FEEDBACK_DATABASE_URL;
    const prevDb = process.env.DATABASE_URL;
    const prevReg = process.env.AGENT_REGULATION_DATABASE_URL;
    delete process.env.AGENT_FEEDBACK_DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.AGENT_REGULATION_DATABASE_URL;

    const store = createRegulationStoreFromEnv();
    expect(store.listTopics()).resolves.toEqual([]);
    expect(store.getTopic('x')).resolves.toBeNull();
    expect(store.getTextsByTopicId('x')).resolves.toEqual([]);
    expect(store.seedTopics()).resolves.toMatchObject({ seeded: 0, error: expect.stringContaining('configured') });

    if (prevAgent !== undefined) process.env.AGENT_FEEDBACK_DATABASE_URL = prevAgent;
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    if (prevReg !== undefined) process.env.AGENT_REGULATION_DATABASE_URL = prevReg;
  });
});
