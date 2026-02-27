export interface AgentToolCall {
  toolName: string;
  success: boolean;
  result: Record<string, unknown>;
}

export interface TrendChartPoint {
  date: string;
  price: number;
}

export interface HoldingTrendPayload {
  chart?: {
    points?: TrendChartPoint[];
    range?: string;
  };
  performance?: {
    currentPrice?: number;
    periodChange?: number;
    periodChangePercent?: number;
    sinceEntryChange?: number;
    sinceEntryChangePercent?: number;
  };
}

export interface SymbolOption {
  dataSource?: string;
  label: string;
  symbol: string;
}

export interface WidgetCreateOrderParams {
  dataSource?: string;
  symbol: string;
}

export interface AgentVerification {
  confidence: number;
  flags?: string[];
  isValid: boolean;
}

export interface AgentConversationMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface AgentTraceStep {
  type: 'llm' | 'tool';
  name: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: unknown;
}

export interface AgentLatency {
  llmMs: number;
  toolMs: number;
  totalMs: number;
}

export interface AgentChatResponse {
  answer: string;
  conversation?: AgentConversationMessage[];
  errors?: { code: string; message: string; recoverable: boolean }[];
  latency?: AgentLatency;
  toolCalls?: AgentToolCall[];
  trace?: AgentTraceStep[];
  verification?: AgentVerification;
}
