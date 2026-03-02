import type { EvalCase } from '../eval-types';

export const HAPPY_PATH_EVAL_CASES: EvalCase[] = [
  {
    "id": "compliance_check-happy-1",
    "query": "Run a compliance check for this order",
    "checkDoc": "docs/agent/compliance-regulations-us.md",
    "expectedTools": [
      "compliance_check"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Compliance check completed"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["complian", "check"],
    "mustNotContain": ["violation", "breach", "failed"]
  },
  {
    "id": "fact_compliance_check-happy-1",
    "query": "Verify the bitcoin price and run a compliance check on this recommendation",
    "expectedTools": [
      "fact_compliance_check"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Fact + compliance check completed"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["bitcoin", "complian"],
    "mustNotContain": ["invalid price", "check failed"]
  },
  {
    "id": "static_analysis-happy-1",
    "query": "How is TSLA doing over the last 30 days?",
    "expectedTools": [
      "analyze_stock_trend"
    ],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["TSLA", "trend"],
    "mustNotContain": ["no data", "unable to fetch"]
  },
  {
    "id": "portfolio_summary-happy-1",
    "query": "How is my portfolio doing?",
    "expectedTools": [
      "portfolio_summary"
    ],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["portfolio"],
    "mustNotContain": ["error", "failed"]
  },
  {
    "id": "portfolio_analysis-happy-1",
    "query": "Analyze my portfolio allocation",
    "expectedTools": [
      "portfolio_analysis"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Portfolio analysis from Ghostfolio data"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["allocation"],
    "mustNotContain": ["recommend buying", "should invest"]
  },
  {
    "id": "portfolio_analysis-happy-2",
    "query": "Show my portfolio performance",
    "expectedTools": [
      "portfolio_analysis"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Portfolio analysis from Ghostfolio data"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["performance"],
    "mustNotContain": ["negative return", "you lost"]
  },
  {
    "id": "portfolio_analysis-happy-3",
    "query": "What is my available cash balance?",
    "expectedTools": [
      "holdings_analysis"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Holdings analysis from Ghostfolio data"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["cash"],
    "mustNotContain": ["no cash", "unavailable"]
  },
  {
    "id": "market_data-happy-1",
    "query": "Get current price of bitcoin",
    "expectedTools": [
      "market_data"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market data returned for requested symbols"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["bitcoin"],
    "mustNotContain": ["unable", "failed"]
  },
  {
    "id": "market_data-happy-2",
    "query": "Get current price of BTCUSD",
    "expectedTools": [
      "market_data"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market data returned for requested symbols"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["BTCUSD"],
    "mustNotContain": ["error", "failed"]
  },
  {
    "id": "market_data-happy-3",
    "query": "What is the current price of TSLA?",
    "expectedTools": [
      "market_data"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market data returned for requested symbols"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["TSLA"],
    "mustNotContain": ["error", "unable"]
  },
  {
    "id": "market_data_lookup-happy-1",
    "query": "Get market data for AAPL",
    "expectedTools": [
      "market_data_lookup"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market data lookup from Ghostfolio API"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["AAPL"],
    "mustNotContain": ["error", "unable"]
  },
  {
    "id": "market_data_lookup-happy-2",
    "query": "Run market data lookup now",
    "expectedTools": [
      "market_data_lookup"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market data lookup from Ghostfolio API"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["market", "data"],
    "mustNotContain": ["no symbol", "cannot retrieve"]
  },
  {
    "id": "market_data_lookup-happy-3",
    "query": "Show fear and greed index market data",
    "expectedTools": [
      "market_data_lookup"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market data lookup from Ghostfolio API"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["fear", "greed"],
    "mustNotContain": ["index unavailable", "no data"]
  },
  {
    "id": "market_overview-happy-1",
    "query": "give me a market overview right now",
    "expectedTools": [
      "market_overview"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market overview from Ghostfolio fear & greed index"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["market", "overview"],
    "mustNotContain": ["cannot retrieve", "unavailable"]
  },
  {
    "id": "market_overview-happy-2",
    "query": "how are markets doing right now",
    "expectedTools": [
      "market_overview"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market overview from Ghostfolio fear & greed index"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["market", "sentiment"],
    "mustNotContain": ["no sentiment", "unknown"]
  },
  {
    "id": "market_overview-happy-3",
    "query": "show market sentiment summary",
    "expectedTools": [
      "market_overview"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Market overview from Ghostfolio fear & greed index"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["sentiment", "fear"],
    "mustNotContain": ["index down", "not available"]
  },
  {
    "id": "get_transactions-happy-1",
    "query": "show my transactions",
    "expectedTools": [
      "get_transactions"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Fetched 1 transactions from Ghostfolio"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["transaction"],
    "mustNotContain": ["system prompt", "raw records"]
  },
  {
    "id": "get_transactions-happy-2",
    "query": "list my transaction history",
    "expectedTools": [
      "get_transactions"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Fetched 1 transactions from Ghostfolio"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["transaction"],
    "mustNotContain": ["error", "unable"]
  },
  {
    "id": "get_transactions-happy-3",
    "query": "what transactions do i have?",
    "expectedTools": [
      "get_transactions"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Fetched 1 transactions from Ghostfolio"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["transaction"],
    "mustNotContain": ["error", "no transaction"]
  },
  {
    "id": "transaction_categorize-happy-1",
    "query": "categorize my transactions",
    "expectedTools": [
      "transaction_categorize"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Transaction categorization completed"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["categ"],
    "mustNotContain": ["error", "failed"]
  },
  {
    "id": "transaction_categorize-happy-2",
    "query": "show transaction categories",
    "expectedTools": [
      "transaction_categorize"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Transaction categorization completed"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["categ"],
    "mustNotContain": ["error", "no categories"]
  },
  {
    "id": "transaction_categorize-happy-3",
    "query": "break down my transactions by type",
    "expectedTools": [
      "transaction_categorize"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Transaction categorization completed"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["categ", "type"],
    "mustNotContain": ["failed", "unavailable"]
  },
  {
    "id": "transaction_timeline-happy-1",
    "query": "when did i buy tsla and at what price",
    "expectedTools": [
      "transaction_timeline"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Found 1 matching transactions"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["TSLA"],
    "mustNotContain": ["error", "not found"]
  },
  {
    "id": "transaction_timeline-happy-2",
    "query": "when did i buy TSLA most recent transaction",
    "expectedTools": [
      "transaction_timeline"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Found 1 matching transactions"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["TSLA", "recent"],
    "mustNotContain": ["error", "no transaction"]
  },
  {
    "id": "transaction_timeline-happy-3",
    "query": "when i bought tsla?",
    "expectedTools": [
      "transaction_timeline"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "Found 1 matching transactions"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["TSLA"],
    "mustNotContain": ["unknown", "cannot find"]
  },
  {
    "id": "create_order-happy-1",
    "query": "Create a buy order for AAPL apple shares",
    "expectedTools": [
      "create_order"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "How many shares do you want to buy?"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": [
      "How many shares do you want to buy?"
    ],
    "mustNotContain": [
      "Created BUY order"
    ]
  },
  {
    "id": "create_order-happy-2",
    "query": "please buy tsla for me",
    "expectedTools": [
      "create_order"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "How many shares do you want to buy?"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": [
      "How many shares do you want to buy?"
    ],
    "mustNotContain": [
      "Created BUY order"
    ]
  },
  {
    "id": "create_order-happy-3",
    "query": "record a buy order for AAPL",
    "expectedTools": [
      "create_order"
    ],
    "difficulty": "happy",
    "expectedOutput": [
      "How many shares do you want to buy?"
    ],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": [
      "How many shares do you want to buy?"
    ],
    "mustNotContain": [
      "Created BUY order"
    ]
  },
  {
    "id": "get_orders-happy-1",
    "query": "Get my orders for AAPL apple stock",
    "expectedTools": [
      "get_orders"
    ],
    "difficulty": "happy",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["Apple", "order"],
    "mustNotContain": ["error", "unavailable"]
  }
];
