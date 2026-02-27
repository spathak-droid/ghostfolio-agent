/**
 * Purpose: Store IRS/SEC regulation topics and their fetched text in Postgres (source of truth).
 * Inputs: topic id, optional rule_id mapping; fetcher job populates regulation_text.
 * Outputs: listTopics, getTopic, getTextsByTopicId; seedTopics for initial 10 topics.
 * Failure modes: DB disabled/misconfigured, schema init failure — same lazy Prisma pattern as feedback-store.
 */

export interface RegulationTopicRow {
  id: string;
  name: string;
  key_references: string[];
  source: string;
  rule_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RegulationTextRow {
  id: string;
  topic_id: string;
  source_url: string;
  content: string;
  chunk_index: number;
  fetched_at: Date;
  created_at: Date;
}

export interface RegulationStore {
  listTopics(): Promise<RegulationTopicRow[]>;
  getTopic(id: string): Promise<RegulationTopicRow | null>;
  getTextsByTopicId(topicId: string): Promise<RegulationTextRow[]>;
  /** Idempotent insert/update of fetched text for a topic URL. Re-run replaces content. */
  insertRegulationText(params: {
    topic_id: string;
    source_url: string;
    content: string;
    chunk_index?: number;
  }): Promise<{ id: string } | { error: string }>;
  /** Idempotent insert of default 10 topics; does not fetch or fill regulation_text. */
  seedTopics(): Promise<{ seeded: number; error?: string }>;
}

interface PrismaExecutor {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

const DEFAULT_TOPICS: readonly {
  id: string;
  name: string;
  key_references: readonly string[];
  source: string;
  rule_id: string;
}[] = [
  {
    id: 'wash-sale',
    name: 'Wash Sale Rule',
    key_references: [
      'https://www.irs.gov/publications/p550',
      'https://www.law.cornell.edu/uscode/text/26/1091'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-WASH-SALE'
  },
  {
    id: 'capital-gains',
    name: 'Capital Gains Tax',
    key_references: [
      'https://www.irs.gov/taxtopics/tc409',
      'https://www.irs.gov/publications/p544',
      'https://www.irs.gov/instructions/i1040sd'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-CAPITAL-GAINS'
  },
  {
    id: 'qualified-dividends',
    name: 'Qualified Dividend Taxation',
    key_references: [
      'https://www.irs.gov/taxtopics/tc404',
      'https://www.irs.gov/publications/p550',
      'https://www.irs.gov/instructions/i1040gi'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-QUALIFIED-DIVIDENDS'
  },
  {
    id: 'tax-loss-harvesting',
    name: 'Tax Loss Harvesting',
    key_references: [
      'https://www.irs.gov/taxtopics/tc409',
      'https://www.irs.gov/publications/p550'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-TAX-LOSS-HARVESTING'
  },
  {
    id: 'cost-basis-methods',
    name: 'Cost Basis Methods',
    key_references: [
      'https://www.irs.gov/publications/p550',
      'https://www.irs.gov/taxtopics/tc703'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-COST-BASIS'
  },
  {
    id: 'ira-contribution-limits',
    name: 'IRA Contribution Limits',
    key_references: [
      'https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits',
      'https://www.irs.gov/publications/p590a'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-IRA-LIMITS'
  },
  {
    id: 'required-minimum-distributions',
    name: 'RMDs',
    key_references: [
      'https://www.irs.gov/retirement-plans/retirement-plan-and-ira-required-minimum-distributions-faqs',
      'https://www.irs.gov/publications/p590b'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-RMD'
  },
  {
    id: 'net-investment-income-tax',
    name: 'NIIT (3.8% Surtax)',
    key_references: [
      'https://www.irs.gov/individuals/net-investment-income-tax',
      'https://www.irs.gov/instructions/i8960'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-NIIT'
  },
  {
    id: 'alternative-minimum-tax',
    name: 'AMT',
    key_references: [
      'https://www.irs.gov/taxtopics/tc556',
      'https://www.irs.gov/instructions/i6251'
    ],
    source: 'IRS',
    rule_id: 'R-IRS-AMT'
  },
  {
    id: 'etf-tax-efficiency',
    name: 'ETF Tax Efficiency',
    key_references: [
      'https://www.sec.gov/investor/pubs/sec-guide-to-etfs.htm',
      'https://www.irs.gov/publications/p550'
    ],
    source: 'SEC',
    rule_id: 'R-SEC-ETF-TAX-EFFICIENCY'
  }
];

class DisabledRegulationStore implements RegulationStore {
  public constructor(private readonly reason: string) {}

  public async listTopics(): Promise<RegulationTopicRow[]> {
    return [];
  }

  public async getTopic(): Promise<RegulationTopicRow | null> {
    return null;
  }

  public async getTextsByTopicId(): Promise<RegulationTextRow[]> {
    return [];
  }

  public async insertRegulationText(): Promise<{ id: string } | { error: string }> {
    return { error: this.reason };
  }

  public async seedTopics(): Promise<{ seeded: number; error?: string }> {
    return { seeded: 0, error: this.reason };
  }
}

function parseTopicRow(row: Record<string, unknown>): RegulationTopicRow {
  const keyRefs = row.key_references;
  return {
    id: String(row.id),
    name: String(row.name),
    key_references: Array.isArray(keyRefs)
      ? keyRefs.map((u) => String(u))
      : [],
    source: String(row.source ?? ''),
    rule_id: row.rule_id != null ? String(row.rule_id) : null,
    created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
  };
}

function parseTextRow(row: Record<string, unknown>): RegulationTextRow {
  return {
    id: String(row.id),
    topic_id: String(row.topic_id),
    source_url: String(row.source_url),
    content: String(row.content ?? ''),
    chunk_index: Number(row.chunk_index) || 0,
    fetched_at: row.fetched_at instanceof Date ? row.fetched_at : new Date(String(row.fetched_at)),
    created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
  };
}

class PostgresRegulationStore implements RegulationStore {
  private initialized = false;
  private initPromise: Promise<void> | undefined;

  public constructor(private readonly prisma: PrismaExecutor) {}

  public async listTopics(): Promise<RegulationTopicRow[]> {
    await this.ensureInitialized();
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, name, key_references, source, rule_id, created_at, updated_at
       FROM regulation_topic
       ORDER BY id`
    );
    return rows.map(parseTopicRow);
  }

  public async getTopic(id: string): Promise<RegulationTopicRow | null> {
    await this.ensureInitialized();
    const trimmed = id.trim();
    if (!trimmed) return null;
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, name, key_references, source, rule_id, created_at, updated_at
       FROM regulation_topic
       WHERE id = $1`,
      trimmed
    );
    const row = rows[0];
    return row ? parseTopicRow(row) : null;
  }

  public async getTextsByTopicId(topicId: string): Promise<RegulationTextRow[]> {
    await this.ensureInitialized();
    const trimmed = topicId.trim();
    if (!trimmed) return [];
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT id, topic_id, source_url, content, chunk_index, fetched_at, created_at
       FROM regulation_text
       WHERE topic_id = $1
       ORDER BY source_url, chunk_index`,
      trimmed
    );
    return rows.map(parseTextRow);
  }

  public async insertRegulationText(params: {
    topic_id: string;
    source_url: string;
    content: string;
    chunk_index?: number;
  }): Promise<{ id: string } | { error: string }> {
    try {
      await this.ensureInitialized();
      const chunkIndex = params.chunk_index ?? 0;
      const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO regulation_text (id, topic_id, source_url, content, chunk_index, fetched_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
         ON CONFLICT (topic_id, source_url) DO UPDATE SET
           content = EXCLUDED.content,
           fetched_at = NOW(),
           chunk_index = EXCLUDED.chunk_index
         RETURNING id`,
        params.topic_id.trim(),
        params.source_url.trim(),
        params.content,
        chunkIndex
      );
      const row = rows[0];
      return row ? { id: row.id } : { error: 'insert_regulation_text_no_return' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
    }
  }

  public async seedTopics(): Promise<{ seeded: number; error?: string }> {
    try {
      await this.ensureInitialized();
      let seeded = 0;
      for (const t of DEFAULT_TOPICS) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO regulation_topic (id, name, key_references, source, rule_id, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             key_references = EXCLUDED.key_references,
             source = EXCLUDED.source,
             rule_id = EXCLUDED.rule_id,
             updated_at = NOW()`,
          t.id,
          t.name,
          JSON.stringify([...t.key_references]),
          t.source,
          t.rule_id
        );
        seeded += 1;
      }
      return { seeded };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { seeded: 0, error: message };
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise === undefined) {
      this.initPromise = this.initSchema();
    }
    await this.initPromise;
    this.initialized = true;
  }

  private async initSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS regulation_topic (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(256) NOT NULL,
        key_references JSONB NOT NULL DEFAULT '[]',
        source VARCHAR(32) NOT NULL DEFAULT 'IRS',
        rule_id VARCHAR(64) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS regulation_text (
        id UUID PRIMARY KEY,
        topic_id VARCHAR(64) NOT NULL,
        source_url TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INT NOT NULL DEFAULT 0,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_regulation_text_topic_id ON regulation_text(topic_id)'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_regulation_text_fetched_at ON regulation_text(fetched_at DESC)'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_regulation_text_topic_source ON regulation_text(topic_id, source_url)'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_regulation_text_topic_url_unique ON regulation_text(topic_id, source_url)'
    );
  }
}

export function createRegulationStoreFromEnv(): RegulationStore {
  const databaseUrl =
    process.env.AGENT_FEEDBACK_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.AGENT_REGULATION_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return new DisabledRegulationStore('regulation database url is not configured');
  }
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl }
      }
    }) as unknown as PrismaExecutor;
    return new PostgresRegulationStore(prisma);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new DisabledRegulationStore(
      `regulation database configured but Prisma unavailable: ${message}. Run prisma generate if using Postgres.`
    );
  }
}

export function createRegulationStoreForTest(prisma: PrismaExecutor): RegulationStore {
  return new PostgresRegulationStore(prisma);
}

export { DEFAULT_TOPICS };
