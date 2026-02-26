import { createKeyv } from '@keyv/redis';

import type {
  AgentConversationMessage,
  AgentToolName,
  CreateOrderParams
} from './types';
import { logger } from './logger';

const DEFAULT_CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STORE_NAMESPACE = 'agent:conversation';

export interface AgentWorkflowState {
  pendingAction: 'awaiting_clarification' | 'idle';
  pendingTool?: AgentToolName;
  missingFields?: string[];
  draftCreateOrderParams?: Partial<CreateOrderParams>;
  lastTool?: AgentToolName;
  verificationFlags: string[];
  contextSummary?: string;
  pinnedFacts?: string[];
  updatedAt: string;
}

export interface AgentConversationStore {
  getConversation(conversationId: string): Promise<AgentConversationMessage[]>;
  setConversation(conversationId: string, conversation: AgentConversationMessage[]): Promise<void>;
  getState(conversationId: string): Promise<AgentWorkflowState | undefined>;
  setState(conversationId: string, state: AgentWorkflowState): Promise<void>;
}

export function createInMemoryConversationStore(): AgentConversationStore {
  const conversations = new Map<string, AgentConversationMessage[]>();
  const states = new Map<string, AgentWorkflowState>();

  return {
    async getConversation(conversationId: string) {
      const value = conversations.get(conversationId);
      return Array.isArray(value) ? [...value] : [];
    },
    async setConversation(conversationId: string, conversation: AgentConversationMessage[]) {
      conversations.set(conversationId, [...conversation]);
    },
    async getState(conversationId: string) {
      const state = states.get(conversationId);
      if (!state) {
        return undefined;
      }

      return {
        ...state,
        draftCreateOrderParams: isRecord(state.draftCreateOrderParams)
          ? { ...state.draftCreateOrderParams }
          : undefined,
        missingFields: Array.isArray(state.missingFields) ? [...state.missingFields] : undefined,
        pinnedFacts: Array.isArray(state.pinnedFacts) ? [...state.pinnedFacts] : undefined,
        verificationFlags: [...state.verificationFlags]
      };
    },
    async setState(conversationId: string, state: AgentWorkflowState) {
      states.set(conversationId, {
        ...state,
        draftCreateOrderParams: isRecord(state.draftCreateOrderParams)
          ? { ...state.draftCreateOrderParams }
          : undefined,
        missingFields: Array.isArray(state.missingFields) ? [...state.missingFields] : undefined,
        pinnedFacts: Array.isArray(state.pinnedFacts) ? [...state.pinnedFacts] : undefined,
        verificationFlags: [...state.verificationFlags]
      });
    }
  };
}

export function createRedisConversationStore({
  namespace = DEFAULT_STORE_NAMESPACE,
  redisUrl,
  ttlMs = DEFAULT_CONVERSATION_TTL_MS
}: {
  namespace?: string;
  redisUrl: string;
  ttlMs?: number;
}): AgentConversationStore {
  const keyv = createKeyv(redisUrl.trim());
  const effectiveTtlMs = normalizeTtl(ttlMs);

  const conversationKey = (conversationId: string) => `${namespace}:messages:${conversationId}`;
  const stateKey = (conversationId: string) => `${namespace}:state:${conversationId}`;

  return {
    async getConversation(conversationId: string) {
      const stored = await keyv.get(conversationKey(conversationId));
      return normalizeConversation(stored);
    },
    async setConversation(conversationId: string, conversation: AgentConversationMessage[]) {
      await keyv.set(conversationKey(conversationId), conversation, effectiveTtlMs);
    },
    async getState(conversationId: string) {
      const stored = await keyv.get(stateKey(conversationId));
      return normalizeWorkflowState(stored);
    },
    async setState(conversationId: string, state: AgentWorkflowState) {
      await keyv.set(stateKey(conversationId), state, effectiveTtlMs);
    }
  };
}

export function createConversationStoreFromEnv({
  redisUrl,
  storeType,
  ttlMs
}: {
  storeType?: string;
  redisUrl?: string;
  ttlMs?: number;
}): AgentConversationStore {
  const normalizedStoreType = (storeType ?? 'memory').trim().toLowerCase();
  if (normalizedStoreType !== 'redis') {
    return createInMemoryConversationStore();
  }

  if (!redisUrl?.trim()) {
    logger.warn(
      '[agent] AGENT_CONVERSATION_STORE=redis but no redis URL was provided. Falling back to memory store.'
    );
    return createInMemoryConversationStore();
  }

  try {
    return createRedisConversationStore({
      redisUrl: redisUrl.trim(),
      ttlMs
    });
  } catch {
    logger.warn('[agent] Failed to initialize Redis conversation store. Falling back to memory store.');
    return createInMemoryConversationStore();
  }
}

function normalizeConversation(value: unknown): AgentConversationMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is AgentConversationMessage => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      const record = entry as Record<string, unknown>;
      return (
        typeof record.content === 'string' &&
        (record.role === 'user' || record.role === 'assistant')
      );
    })
    .map(({ content, role }) => ({ content, role }));
}

function normalizeWorkflowState(value: unknown): AgentWorkflowState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const pendingAction =
    record.pendingAction === 'awaiting_clarification' ? 'awaiting_clarification' : 'idle';
  const pendingTool =
    typeof record.pendingTool === 'string' ? (record.pendingTool as AgentToolName) : undefined;
  const lastTool = typeof record.lastTool === 'string' ? (record.lastTool as AgentToolName) : undefined;
  const missingFields = Array.isArray(record.missingFields)
    ? record.missingFields.filter((item): item is string => typeof item === 'string')
    : undefined;
  const pinnedFacts = Array.isArray(record.pinnedFacts)
    ? record.pinnedFacts.filter((item): item is string => typeof item === 'string')
    : undefined;
  const verificationFlags = Array.isArray(record.verificationFlags)
    ? record.verificationFlags.filter((item): item is string => typeof item === 'string')
    : [];
  const contextSummary =
    typeof record.contextSummary === 'string' ? record.contextSummary : undefined;
  const updatedAt =
    typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString();
  const draftCreateOrderParams = isRecord(record.draftCreateOrderParams)
    ? (record.draftCreateOrderParams as Partial<CreateOrderParams>)
    : undefined;

  return {
    contextSummary,
    draftCreateOrderParams,
    lastTool,
    missingFields,
    pendingAction,
    pendingTool,
    pinnedFacts,
    updatedAt,
    verificationFlags
  };
}

function normalizeTtl(ttlMs: number) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return DEFAULT_CONVERSATION_TTL_MS;
  }

  return ttlMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
