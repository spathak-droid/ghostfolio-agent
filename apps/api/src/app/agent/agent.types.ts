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
    | 'compliance_check'
    | 'get_transactions'
    | 'market_data'
    | 'analyze_stock_trend'
    | 'market_data_lookup'
    | 'market_overview'
    | 'portfolio_analysis'
    | 'holdings_analysis'
    | 'transaction_categorize'
    | 'transaction_timeline'
    | 'create_order'
    | 'create_other_activities'
    | 'get_orders';
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

export interface AgentTraceStep {
  type: 'llm' | 'tool';
  name: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

export interface AgentChatResponse {
  answer: string;
  conversation: AgentConversationMessage[];
  errors: AgentError[];
  toolCalls: AgentToolCall[];
  trace?: AgentTraceStep[];
  verification: AgentVerification;
}
