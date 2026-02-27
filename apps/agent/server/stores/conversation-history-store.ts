/**
 * Purpose: Persist agent conversation history to Postgres for cross-session history and widget history UI.
 * Inputs: conversationId, userId, messages, optional title.
 * Outputs: save acknowledgement; list by user; get by id (scoped to user).
 * Failure modes: DB disabled/misconfigured, schema init failure, insert/update failure.
 *
 * Uses same pattern as feedback-store: raw SQL, optional DATABASE_URL, CREATE TABLE IF NOT EXISTS.
 */

import type { AgentConversationMessage } from '../types';
import { logger } from '../utils';

export interface ConversationHistoryEntry {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationHistoryItem {
  id: string;
  userId: string;
  title: string | null;
  messages: AgentConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationHistoryStore {
  save(input: {
    conversationId: string;
    userId: string;
    messages: AgentConversationMessage[];
    title?: string | null;
  }): Promise<{ ok: boolean; error?: string }>;
  listByUser(userId: string, limit?: number): Promise<ConversationHistoryEntry[]>;
  getById(conversationId: string, userId: string): Promise<ConversationHistoryItem | null>;
}

interface PrismaExecutor {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}

class DisabledConversationHistoryStore implements ConversationHistoryStore {
  public constructor(private readonly reason: string) {}

  public save(): Promise<{ ok: boolean; error?: string }> {
    return Promise.resolve({ ok: false, error: this.reason });
  }

  public listByUser(): Promise<ConversationHistoryEntry[]> {
    return Promise.resolve([]);
  }

  public getById(): Promise<ConversationHistoryItem | null> {
    return Promise.resolve(null);
  }
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_TITLE_LENGTH = 512;

function deriveTitle(messages: AgentConversationMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return null;
  const trimmed = firstUser.content.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_TITLE_LENGTH - 3) + '...';
}

function normalizeMessages(value: unknown): AgentConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AgentConversationMessage => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.content === 'string' &&
      (record.role === 'user' || record.role === 'assistant')
    );
  }).map(({ content, role }) => ({ content, role }));
}

class PostgresConversationHistoryStore implements ConversationHistoryStore {
  private initialized = false;
  private initializePromise?: Promise<void>;

  public constructor(private readonly prisma: PrismaExecutor) {}

  public async save(input: {
    conversationId: string;
    userId: string;
    messages: AgentConversationMessage[];
    title?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureInitialized();
      const messagesJson = JSON.stringify(input.messages);
      const title = input.title ?? deriveTitle(input.messages);
      const now = new Date().toISOString();
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConversation" (id, "userId", title, messages, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           "userId" = EXCLUDED."userId",
           title = COALESCE(EXCLUDED.title, "AgentConversation".title),
           messages = EXCLUDED.messages,
           "updatedAt" = EXCLUDED."updatedAt"`,
        input.conversationId,
        input.userId,
        title ?? null,
        messagesJson,
        now,
        now
      );
      return { ok: true };
    } catch (error) {
      logger.warn('[agent.history] save_failed', {
        conversationId: input.conversationId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'conversation_history_persist_failed'
      };
    }
  }

  public async listByUser(userId: string, limit = DEFAULT_LIST_LIMIT): Promise<ConversationHistoryEntry[]> {
    try {
      await this.ensureInitialized();
      const rows = await this.prisma.$queryRawUnsafe<
        { id: string; title: string | null; updatedAt: Date; messages: unknown }[]
      >(
        `SELECT id, title, "updatedAt", messages
         FROM "AgentConversation"
         WHERE "userId" = $1
         ORDER BY "updatedAt" DESC
         LIMIT $2`,
        userId,
        Math.min(100, Math.max(1, limit))
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
        messageCount: Array.isArray(row.messages) ? row.messages.length : 0
      }));
    } catch (error) {
      logger.warn('[agent.history] list_by_user_failed', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  public async getById(conversationId: string, userId: string): Promise<ConversationHistoryItem | null> {
    try {
      await this.ensureInitialized();
      const rows = await this.prisma.$queryRawUnsafe<
        { id: string; userId: string; title: string | null; messages: unknown; createdAt: Date; updatedAt: Date }[]
      >(
        `SELECT id, "userId", title, messages, "createdAt", "updatedAt"
         FROM "AgentConversation"
         WHERE id = $1 AND "userId" = $2`,
        conversationId,
        userId
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        title: row.title,
        messages: normalizeMessages(row.messages),
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
      };
    } catch (error) {
      logger.warn('[agent.history] get_by_id_failed', {
        conversationId,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
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
      `CREATE TABLE IF NOT EXISTS "AgentConversation" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        title VARCHAR(512),
        messages JSONB NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AgentConversation_userId_updatedAt_idx"
       ON "AgentConversation" ("userId", "updatedAt" DESC)`
    ).catch(() => {
      // Index may already exist
    });
  }
}

export function createConversationHistoryStoreFromEnv(): ConversationHistoryStore {
  const databaseUrl =
    process.env.AGENT_HISTORY_DATABASE_URL?.trim() ||
    process.env.AGENT_FEEDBACK_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return new DisabledConversationHistoryStore('conversation history database url is not configured');
  }
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl }
      }
    }) as unknown as PrismaExecutor;
    return new PostgresConversationHistoryStore(prisma);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new DisabledConversationHistoryStore(
      `conversation history database configured but Prisma unavailable: ${message}. Run prisma generate if using Postgres history.`
    );
  }
}
