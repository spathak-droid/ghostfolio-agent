export interface AgentChatRequest {
  conversationId: string;
  message: string;
}

export interface AgentConversationMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface AgentToolCall {
  toolName:
    | 'get_transactions'
    | 'market_data'
    | 'market_data_lookup'
    | 'portfolio_analysis'
    | 'transaction_categorize'
    | 'transaction_timeline';
  success: boolean;
  result: Record<string, unknown>;
}

export interface AgentError {
  code: 'TOOL_EXECUTION_FAILED';
  message: string;
  recoverable: boolean;
}

export interface AgentVerification {
  checks?: string[];
  confidence: number;
  flags?: string[];
  isValid: boolean;
}

export interface AgentChatResponse {
  answer: string;
  conversation: AgentConversationMessage[];
  errors: AgentError[];
  toolCalls: AgentToolCall[];
  verification: AgentVerification;
}
