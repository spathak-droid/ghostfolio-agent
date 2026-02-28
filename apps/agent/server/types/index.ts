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
  | 'fact_compliance_check'
  | 'fact_check'
  | 'tax_estimate'
  | 'market_data'
  | 'analyze_stock_trend'
  | 'market_data_lookup'
  | 'market_overview'
  | 'portfolio_analysis'
  | 'holdings_analysis'
  | 'static_analysis'
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
  alternative_minimum_tax_topic: boolean;
  capital_gains_topic: boolean;
  concentration_risk: boolean;
  constraints: boolean;
  cost_basis_topic: boolean;
  etf_tax_efficiency_topic: boolean;
  horizon: boolean;
  ira_contribution_limits_topic: boolean;
  is_recommendation: boolean;
  net_investment_income_tax_topic: boolean;
  quote_is_fresh?: boolean;
  quote_staleness_check: boolean;
  qualified_dividends_topic: boolean;
  required_minimum_distributions_topic: boolean;
  replacement_buy_signal: boolean;
  realized_pnl?: string;
  risk_tolerance: boolean;
  tax_loss_harvesting_topic: boolean;
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
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: unknown;
}

export interface AgentLatencyBreakdown {
  llmMs: number;
  toolMs: number;
  totalMs: number;
}

export interface AgentChatResponse {
  answer: string;
  conversation: AgentConversationMessage[];
  errors: AgentError[];
  toolCalls: AgentToolCall[];
  trace?: AgentTraceStep[];
  latency?: AgentLatencyBreakdown;
  verification: AgentVerification;
}

/** Run context is passed as first arg when invoked via traceable(); input (params) may be first or second. */
export interface AgentToolInput {
  conversation_history?: { role: string; content: string }[];
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
  factComplianceCheck: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  factCheck: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  taxEstimate?: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  getOrders: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  getTransactions: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketData: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  analyzeStockTrend?: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketDataLookup: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  marketOverview?: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  portfolioAnalysis: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  holdingsAnalysis: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
  staticAnalysis: (inputOrRun: AgentToolInput, input?: AgentToolInput) => Promise<Record<string, unknown>>;
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

export interface AgentFeedbackMemory {
  dont: string[];
  do: string[];
  sources: number;
  synthesisIssues: string[];
  toolIssues: string[];
}

export interface AgentFeedbackMemoryProvider {
  getForToolSignature: (toolSignature: string) => Promise<AgentFeedbackMemory | undefined>;
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
  /** Interprets tool failure messages into user-facing explanations. Optional. */
  synthesizeToolErrors?: (
    toolErrors: { toolName: string; message: string }[],
    userMessage: string,
    traceContext?: AgentTraceContext
  ) => Promise<string>;
  /** Clarify whether a quantity should be interpreted as coins/units or currency amount. Optional. */
  clarifyQuantityUnit?: (
    message: string,
    symbol: string,
    quantity: number,
    unitPrice: number,
    traceContext?: AgentTraceContext
  ) => Promise<{ unit: 'coins' | 'currency'; clarification: string } | undefined>;
  /** Generate LLM-parsed parameters for each selected tool. Replaces tool-level parsing. Returns parameters plus optional ask_user for clarification. */
  generateToolParameters?: (
    message: string,
    selectedTools: AgentToolName[],
    conversation: AgentConversationMessage[],
    traceContext?: AgentTraceContext
  ) => Promise<Record<string, Record<string, unknown> | undefined | string | null>>;
}
