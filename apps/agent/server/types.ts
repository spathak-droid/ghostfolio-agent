export interface AgentChatRequest {
  conversationId: string;
  impersonationId?: string;
  message: string;
  token?: string;
}

export interface AgentConversationMessage {
  content: string;
  role: 'assistant' | 'user';
}

export interface AgentError {
  code: 'TOOL_EXECUTION_FAILED' | 'LLM_EXECUTION_FAILED';
  message: string;
  recoverable: boolean;
}

export type AgentToolName =
  | 'get_transactions'
  | 'market_data'
  | 'market_data_lookup'
  | 'portfolio_analysis'
  | 'transaction_categorize'
  | 'transaction_timeline';

export interface AgentToolCall {
  toolName: AgentToolName;
  success: boolean;
  result: Record<string, unknown>;
}

export interface AgentVerification {
  confidence: number;
  flags: string[];
  isValid: boolean;
}

/** One step in the agent run (LLM or tool), for trace UI. */
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

/** Run context is passed as first arg when invoked via traceable(); input (params) may be first or second. */
export interface AgentToolInput {
  impersonationId?: string;
  message: string;
  token?: string;
  transactions?: Record<string, unknown>[];
}

export interface AgentTools {
  getTransactions: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketData: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketDataLookup: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  portfolioAnalysis: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  transactionCategorize: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  transactionTimeline: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
}

export interface AgentTraceContext {
  conversationId: string;
  messagePreview: string;
  sessionId: string;
  turnId: number;
}

export interface AgentReasoningDecision {
  intent: 'finance' | 'general';
  mode: 'direct_reply' | 'tool_call';
  rationale?: string;
  tool?: AgentToolName | 'none';
  /** Multiple tools when the user clearly asks for more than one kind of data. */
  tools?: AgentToolName[];
  /** If true, question implies retrieval (price, balance, transactions); prefer tool_call. */
  requires_factual_data?: boolean;
  /** If true, question asks for past/historical data (e.g. "last month", specific year). */
  needs_history?: boolean;
}

export interface AgentLlm {
  answerFinanceQuestion: (
    message: string,
    conversation: AgentConversationMessage[],
    traceContext?: AgentTraceContext
  ) => Promise<string>;
  reasonAboutQuery?: (
    message: string,
    conversation: AgentConversationMessage[],
    traceContext?: AgentTraceContext
  ) => Promise<AgentReasoningDecision>;
  selectTool: (
    message: string,
    conversation: AgentConversationMessage[],
    traceContext?: AgentTraceContext
  ) => Promise<{ tool: AgentToolName | 'none' }>;
  /** Turn tool output summary into a natural-language response. Used after tool execution. Optional for backwards compatibility. */
  synthesizeFromToolResults?: (
    message: string,
    conversation: AgentConversationMessage[],
    toolSummary: string,
    traceContext?: AgentTraceContext
  ) => Promise<string>;
}
