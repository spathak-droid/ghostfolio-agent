import type { AgentChatResponse } from '../types';
import type { GhostfolioClient } from '../clients';

export interface ConversationStoreLike {
  clearConversation(conversationId: string): Promise<void>;
}

export interface FeedbackStoreLike {
  save(payload: {
    answer: string;
    conversationId: string;
    correction?: string;
    latency?: Record<string, unknown>;
    message?: string;
    rating: 'up' | 'down';
    trace?: unknown[];
  }): Promise<{ ok: boolean; feedbackId?: string; error?: string }>;
}

export type CreateAgentWithClient = (
  client: GhostfolioClient,
  storeScopeId: string
) => {
  chat(input: {
    conversationId: string;
    message: string;
    dateFrom?: string;
    dateTo?: string;
    metrics?: string[];
    regulations?: string[];
    range?: string;
    symbol?: string;
    symbols?: string[];
    take?: number;
    type?: string;
    wantsLatest?: boolean;
    createOrderParams?: import('../types').CreateOrderParams;
    impersonationId?: string;
    token?: string;
  }): Promise<AgentChatResponse>;
};
