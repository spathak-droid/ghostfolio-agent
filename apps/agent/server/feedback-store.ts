/**
 * Purpose: Persist agent feedback events into Postgres for downstream training/evaluation.
 * Inputs: validated feedback payload and optional metadata.
 * Outputs: insert acknowledgement with feedback id.
 * Failure modes: DB disabled/misconfigured, schema init failure, insert failure.
 */

import { PrismaClient } from '@prisma/client';
import { buildMemoryFromFeedbackRows } from './feedback-memory';
import type { AgentFeedbackMemory, AgentFeedbackMemoryProvider } from './types';

export interface FeedbackStoreInput {
  answer: string;
  conversationId: string;
  correction?: string;
  latency?: Record<string, unknown>;
  message?: string;
  rating: 'down' | 'up';
  trace?: unknown[];
}

export interface FeedbackStoreSaveResult {
  ok: boolean;
  error?: string;
  feedbackId?: string;
}

interface PrismaExecutor {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

export interface FeedbackStore extends AgentFeedbackMemoryProvider {
  save(input: FeedbackStoreInput): Promise<FeedbackStoreSaveResult>;
}

class DisabledFeedbackStore implements FeedbackStore {
  public constructor(private readonly reason: string) {}

  public save(): Promise<FeedbackStoreSaveResult> {
    return Promise.resolve({ ok: false, error: this.reason });
  }

  public getForToolSignature(): Promise<AgentFeedbackMemory | undefined> {
    return Promise.resolve(undefined);
  }
}

class PostgresFeedbackStore implements FeedbackStore {
  private initialized = false;
  private initializePromise?: Promise<void>;

  public constructor(private readonly prisma: PrismaExecutor) {}

  public async save(input: FeedbackStoreInput): Promise<FeedbackStoreSaveResult> {
    try {
      await this.ensureInitialized();
      const feedbackId = crypto.randomUUID();
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO agent_feedback
        (id, created_at, conversation_id, rating, message, answer, correction, latency_json, trace_json, tool_signature)
        VALUES ($1::uuid, NOW(), $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
        feedbackId,
        input.conversationId,
        input.rating,
        input.message ?? null,
        input.answer,
        input.correction ?? null,
        JSON.stringify(input.latency ?? null),
        JSON.stringify(input.trace ?? null),
        deriveToolSignatureFromTrace(input.trace)
      );
      return { ok: true, feedbackId };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'feedback_persist_failed'
      };
    }
  }

  public async getForToolSignature(toolSignature: string): Promise<AgentFeedbackMemory | undefined> {
    try {
      await this.ensureInitialized();
      const trimmed = toolSignature.trim();
      if (!trimmed) {
        return undefined;
      }
      const rows = await this.prisma.$queryRawUnsafe<
        { answer?: string | null; correction?: string | null; trace_json?: unknown }[]
      >(
        `SELECT answer, correction, trace_json
         FROM agent_feedback
         WHERE rating = 'down'
           AND tool_signature = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        trimmed
      );
      return buildMemoryFromFeedbackRows(rows);
    } catch {
      return undefined;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise === undefined) {
      this.initializePromise = this.initializeSchema();
    }
    await this.initializePromise;
    this.initialized = true;
  }

  private async initializeSchema(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS agent_feedback (
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        conversation_id VARCHAR(256) NOT NULL,
        rating VARCHAR(8) NOT NULL CHECK (rating IN ('up', 'down')),
        message TEXT NULL,
        answer TEXT NOT NULL,
        correction TEXT NULL,
        latency_json JSONB NULL,
        trace_json JSONB NULL,
        tool_signature TEXT NULL
      )`
    );
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS tool_signature TEXT NULL'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_agent_feedback_created_at ON agent_feedback(created_at DESC)'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_agent_feedback_rating ON agent_feedback(rating)'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_agent_feedback_conversation_id ON agent_feedback(conversation_id)'
    );
    await this.prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS idx_agent_feedback_tool_signature ON agent_feedback(tool_signature)'
    );
  }
}

export function createFeedbackStoreFromEnv(): FeedbackStore {
  const databaseUrl =
    process.env.AGENT_FEEDBACK_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return new DisabledFeedbackStore('feedback database url is not configured');
  }
  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl }
    }
  }) as unknown as PrismaExecutor;
  return new PostgresFeedbackStore(prisma);
}

export function createFeedbackStoreForTest(prisma: PrismaExecutor): FeedbackStore {
  return new PostgresFeedbackStore(prisma);
}

function deriveToolSignatureFromTrace(trace: unknown[] | undefined): string | null {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const names: string[] = [];
  for (const step of trace) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const rec = step as Record<string, unknown>;
    if (rec.type !== 'tool') continue;
    if (typeof rec.name === 'string' && rec.name.trim()) {
      names.push(rec.name.trim());
    }
  }
  if (names.length === 0) return null;
  return names.join('>');
}
