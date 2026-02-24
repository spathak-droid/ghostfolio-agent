export interface AgentChatRequest {
  conversationId: string;
  message: string;
  token?: string;
}

export interface AgentConversationMessage {
  content: string;
  role: 'assistant' | 'user';
}

export interface AgentError {
  code: 'TOOL_EXECUTION_FAILED';
  message: string;
  recoverable: boolean;
}

export interface AgentToolCall {
  toolName: 'market_data_lookup' | 'portfolio_analysis' | 'transaction_categorize';
  success: boolean;
  result: Record<string, unknown>;
}

export interface AgentVerification {
  confidence: number;
  flags: string[];
  isValid: boolean;
}

export interface AgentChatResponse {
  answer: string;
  conversation: AgentConversationMessage[];
  errors: AgentError[];
  toolCalls: AgentToolCall[];
  verification: AgentVerification;
}

export interface AgentTools {
  marketDataLookup: (input: { message: string; token?: string }) => Promise<Record<string, unknown>>;
  portfolioAnalysis: (input: { message: string; token?: string }) => Promise<Record<string, unknown>>;
  transactionCategorize: (input: { message: string; token?: string }) => Promise<Record<string, unknown>>;
}
