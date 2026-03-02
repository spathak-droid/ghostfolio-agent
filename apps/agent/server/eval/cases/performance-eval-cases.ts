import type { EvalCase } from '../eval-types';

/**
 * Performance & Scalability evaluation cases
 *
 * These cases establish latency baselines and stress-test
 * the agent with realistic data volumes.
 *
 * Latency budgets:
 * - Small portfolio (<50 holdings): 2-3s
 * - Medium portfolio (50-200 holdings): 4-6s
 * - Large portfolio (200-500 holdings): 8-12s
 * - Very large portfolio (500+): 15-20s
 */
export const PERFORMANCE_EVAL_CASES: EvalCase[] = [
  // Small Portfolio (0-50 holdings)
  {
    "id": "perf-small-portfolio-summary",
    "query": "Give me a quick summary of my portfolio",
    "expectedTools": ["portfolio_summary"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within small portfolio latency budget", "must invoke expected tool"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 3000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Portfolio", "summary"],
    "mustNotContain": []
  },
  {
    "id": "perf-small-portfolio-analysis",
    "query": "Analyze my portfolio allocation",
    "expectedTools": ["portfolio_analysis"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within 3s for small portfolio", "must return detailed analysis"],
    "dimensions": ["tool_execution", "latency", "correctness"],
    "latencyMsMax": 3000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Portfolio", "analysis"],
    "mustNotContain": []
  },
  {
    "id": "perf-small-portfolio-market-lookup",
    "query": "Get current market data for AAPL, MSFT, GOOGL, AMZN, TSLA",
    "expectedTools": ["market_data_lookup"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must fetch 5 symbols within budget", "must complete within 2s"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 2000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Market data", "AAPL", "MSFT"],
    "mustNotContain": []
  },
  {
    "id": "perf-small-portfolio-consistency",
    "query": "What is my portfolio risk level?",
    "expectedTools": ["portfolio_analysis"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete consistently under 3s across runs", "must have minimal variance"],
    "dimensions": ["latency", "consistency"],
    "latencyMsMax": 3000,
    "repeatRuns": 5,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["risk"],
    "mustNotContain": []
  },
  // Medium Portfolio (50-200 holdings)
  {
    "id": "perf-medium-portfolio-summary",
    "query": "Give me a summary of my medium-sized portfolio",
    "expectedTools": ["portfolio_summary"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within medium portfolio latency budget (6s)", "must handle 50-200 holdings"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 6000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Portfolio"],
    "mustNotContain": []
  },
  {
    "id": "perf-medium-portfolio-analysis",
    "query": "Provide detailed portfolio analysis with sector breakdown",
    "expectedTools": ["portfolio_analysis"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within 6s", "must include sector analysis"],
    "dimensions": ["tool_execution", "latency", "correctness"],
    "latencyMsMax": 6000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["portfolio", "analysis"],
    "mustNotContain": []
  },
  {
    "id": "perf-medium-portfolio-transactions",
    "query": "Show me all my transactions from the past year",
    "expectedTools": ["get_transactions"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must fetch transactions within 4s", "must handle medium volume"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 4000,
    "requireSuccessfulToolCalls": false,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "perf-medium-portfolio-large-market-lookup",
    "query": "Get market data for 15 different stocks",
    "expectedTools": ["market_data_lookup"],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": ["must fetch 15 symbols within 4s", "must batch efficiently"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 4000,
    "requireSuccessfulToolCalls": true,
    "expectedToolCountAtLeast": 1,
    "mustContain": ["Market data"],
    "mustNotContain": []
  },
  // Large Portfolio (200-500 holdings)
  {
    "id": "perf-large-portfolio-summary",
    "query": "Summarize my large, complex portfolio",
    "expectedTools": ["portfolio_summary"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within large portfolio budget (12s)", "must handle 200-500 holdings"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 12000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Portfolio"],
    "mustNotContain": []
  },
  {
    "id": "perf-large-portfolio-analysis",
    "query": "Detailed analysis of my 300+ position portfolio",
    "expectedTools": ["portfolio_analysis"],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within 12s", "must calculate allocations accurately"],
    "dimensions": ["tool_execution", "latency", "correctness"],
    "latencyMsMax": 12000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["portfolio"],
    "mustNotContain": []
  },
  {
    "id": "perf-large-portfolio-holdings",
    "query": "Show my holdings breakdown by asset class",
    "expectedTools": ["holdings_analysis"],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within 10s", "must group holdings efficiently"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 10000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["holdings"],
    "mustNotContain": []
  },
  {
    "id": "perf-large-portfolio-transactions-bulk",
    "query": "List all transactions from the past 3 years",
    "expectedTools": ["get_transactions"],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": ["must handle large transaction volume", "must complete within 8s"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 8000,
    "requireSuccessfulToolCalls": false,
    "mustContain": [],
    "mustNotContain": []
  },
  // Stress Tests
  {
    "id": "perf-stress-rapid-succession",
    "query": "Get market data for AAPL",
    "expectedTools": ["market_data_lookup"],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": ["must handle 10 queries in succession", "must maintain latency under cache pressure"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 2500,
    "repeatRuns": 10,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Market data"],
    "mustNotContain": []
  },
  {
    "id": "perf-stress-many-symbols",
    "query": "Get market data for 50 different symbols",
    "expectedTools": ["market_data_lookup"],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": ["must batch 50 symbols efficiently", "must complete within 8s"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 8000,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Market data"],
    "mustNotContain": []
  },
  // Multi-Step Performance
  {
    "id": "perf-multistep-portfolio-market",
    "query": "Analyze my portfolio and get current market data for my top 10 holdings",
    "expectedTools": ["portfolio_analysis", "market_data_lookup"],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": ["must invoke both tools", "must complete within 8s total"],
    "dimensions": ["tool_execution", "latency", "correctness"],
    "latencyMsMax": 8000,
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["portfolio"],
    "mustNotContain": []
  },
  {
    "id": "perf-multistep-transactions-categorize",
    "query": "Show my transactions and categorize them by type",
    "expectedTools": ["get_transactions", "transaction_categorize"],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": ["must fetch and categorize within 6s", "must handle medium transaction volume"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 6000,
    "requireSuccessfulToolCalls": true,
    "expectedToolCountAtLeast": 2,
    "mustContain": [],
    "mustNotContain": []
  },
  // Cache Hit Performance
  {
    "id": "perf-cache-market-repeated",
    "query": "What is the price of AAPL?",
    "expectedTools": ["market_data_lookup"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["first run: <2s", "subsequent runs: <500ms (cached)"],
    "dimensions": ["latency"],
    "latencyMsMax": 2000,
    "repeatRuns": 3,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["AAPL"],
    "mustNotContain": [],
    "note": "Tests Redis/in-memory cache effectiveness. 2nd+ runs should be <500ms."
  },
  // Real LLM Synthesis Overhead
  {
    "id": "perf-llm-synthesis-portfolio",
    "query": "Summarize my portfolio in plain English",
    "expectedTools": ["portfolio_summary"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete LLM synthesis within 4s", "must be human-readable"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 4000,
    "requireSuccessfulToolCalls": true,
    "requireLlmSynthesis": true,
    "mustContain": ["portfolio"],
    "mustNotContain": []
  },
  {
    "id": "perf-llm-synthesis-market",
    "query": "Explain the current market outlook based on today's data",
    "expectedTools": ["market_overview"],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": ["must complete within 5s including LLM synthesis", "must provide insights"],
    "dimensions": ["tool_execution", "latency"],
    "latencyMsMax": 5000,
    "requireSuccessfulToolCalls": true,
    "requireLlmSynthesis": true,
    "mustContain": ["market"],
    "mustNotContain": []
  }
];
