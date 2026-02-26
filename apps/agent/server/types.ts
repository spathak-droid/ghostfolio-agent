export interface AgentChatRequest {
  conversationId: string;
  impersonationId?: string;
  message: string;
  regulations?: string[];
  dateFrom?: string;
  dateTo?: string;
  metrics?: string[];
  range?: string;
  symbol?: string;
  symbols?: string[];
  take?: number;
  token?: string;
  type?: string;
  wantsLatest?: boolean;
  createOrderParams?: CreateOrderParams;
}

export interface AgentConversationMessage {
  content: string;
  role: 'assistant' | 'user';
}

export interface AgentError {
  code:
    | 'TOOL_EXECUTION_FAILED'
    | 'TOOL_EXECUTION_TIMEOUT'
    | 'LLM_EXECUTION_FAILED'
    | 'LLM_EXECUTION_TIMEOUT';
  message: string;
  recoverable: boolean;
}

export type AgentToolName =
  | 'get_orders'
  | 'get_transactions'
  | 'compliance_check'
  | 'market_data'
  | 'market_data_lookup'
  | 'market_overview'
  | 'portfolio_analysis'
  | 'transaction_categorize'
  | 'transaction_timeline'
  | 'create_order'
  | 'create_other_activities';

/** Order activity type (Ghostfolio API). */
export type OrderType = 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'INTEREST' | 'LIABILITY';

/** Params for create_order tool (from LLM extraction). Tool sets updateAccountBalance: true. */
export interface CreateOrderParams {
  symbol?: string;
  type?: OrderType;
  quantity?: number;
  unitPrice?: number;
  date?: string;
  currency?: string;
  fee?: number;
  accountId?: string;
  dataSource?: string;
  comment?: string;
}

export interface ComplianceFacts {
  concentration_risk: boolean;
  constraints: boolean;
  horizon: boolean;
  is_recommendation: boolean;
  quote_is_fresh?: boolean;
  quote_staleness_check: boolean;
  replacement_buy_signal: boolean;
  realized_pnl?: string;
  risk_tolerance: boolean;
  transaction_type?: string;
}

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
  regulations?: string[];
  dateFrom?: string;
  dateTo?: string;
  metrics?: string[];
  range?: string;
  symbol?: string;
  symbols?: string[];
  take?: number;
  token?: string;
  transactions?: Record<string, unknown>[];
  type?: string;
  wantsLatest?: boolean;
  createOrderParams?: CreateOrderParams;
}

export interface AgentTools {
  complianceCheck: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  getOrders: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  getTransactions: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketData: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketDataLookup: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketOverview?: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  portfolioAnalysis: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  transactionCategorize: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  transactionTimeline: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  createOrder: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  createOtherActivities?: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
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
  /** Extract structured params for create_order or create_other_activities from conversation. Optional. */
  getToolParametersForOrder?: (
    message: string,
    conversation: AgentConversationMessage[],
    toolName: 'create_order' | 'create_other_activities',
    traceContext?: AgentTraceContext
  ) => Promise<Partial<CreateOrderParams> | undefined>;
  /** Extract normalized compliance facts from free text. Optional; deterministic fallback remains available. */
  extractComplianceFacts?: (
    message: string,
    traceContext?: AgentTraceContext
  ) => Promise<Partial<ComplianceFacts> | undefined>;
}
