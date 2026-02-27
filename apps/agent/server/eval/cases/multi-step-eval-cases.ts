import type { EvalCase } from '../eval-types';

export const MULTI_STEP_EVAL_CASES: EvalCase[] = [
  {
    "id": "portfolio_analysis-multi-step-1",
    "query": "Analyze my portfolio allocation and categorize my transactions",
    "expectedTools": [
      "portfolio_analysis",
      "get_transactions",
      "transaction_categorize"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "market_data-multi-step-1",
    "query": "Get current price of bitcoin and show market overview",
    "expectedTools": [
      "market_data",
      "market_overview"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "market_data_lookup-multi-step-1",
    "query": "Get market data and give me a market overview right now",
    "expectedTools": [
      "market_data_lookup",
      "market_overview"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "market_overview-multi-step-1",
    "query": "Give me a market overview and get market data for AAPL",
    "expectedTools": [
      "market_overview",
      "market_data_lookup"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "get_transactions-multi-step-1",
    "query": "show my transactions and categorize them",
    "expectedTools": [
      "get_transactions",
      "transaction_categorize"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "transaction_categorize-multi-step-1",
    "query": "categorize my transactions and tell me when i bought tsla",
    "expectedTools": [
      "get_transactions",
      "transaction_categorize",
      "transaction_timeline"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "transaction_timeline-multi-step-1",
    "query": "when did i buy tsla and categorize my transactions too",
    "expectedTools": [
      "get_transactions",
      "transaction_timeline",
      "transaction_categorize"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "create_order-multi-step-1",
    "query": "I want to buy apple shares and then analyze my portfolio allocation",
    "expectedTools": [
      "create_order"
    ],
    "difficulty": "multi",
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
    "id": "global-multi-consistency-market",
    "query": "Get market data for AAPL and give me a market overview right now",
    "expectedTools": [
      "market_data_lookup",
      "market_overview"
    ],
    "difficulty": "multi",
    "expectedOutput": [
      "Market data lookup from Ghostfolio API"
    ],
    "passFailCriteria": [
      "repeated runs should remain consistent in route/tool signature",
      "must invoke both market tools",
      "must include expected market lookup payload text"
    ],
    "dimensions": [
      "consistency",
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 2,
    "repeatRuns": 3,
    "requireLlmReasoning": true,
    "requireLlmSynthesis": true,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": [
      "I executed a buy order"
    ]
  },
  {
    "id": "fact_compliance_check-multi-step-1",
    "query": "fact-check this trade and run a compliance check for wash sale and disclosures",
    "checkDoc": "docs/agent/compliance-regulations-us.md",
    "expectedTools": [
      "fact_compliance_check"
    ],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must handle combined fact+compliance intent"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "portfolio_and_holdings-multi-step-1",
    "query": "analyze my portfolio allocation and also show holdings analysis",
    "expectedTools": [
      "portfolio_analysis",
      "holdings_analysis"
    ],
    "difficulty": "multi",
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
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "market_and_fact_check-multi-step-1",
    "query": "get market data for btc and then fact check btc price",
    "expectedTools": [
      "market_data",
      "fact_check"
    ],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include both market and fact verification steps"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "transactions_and_orders-multi-step-1",
    "query": "show my recent transactions and also list my orders",
    "expectedTools": [
      "get_transactions",
      "get_orders"
    ],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must combine transaction and order retrieval"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "categorize_and_timeline-multi-step-1",
    "query": "categorize my transactions and tell me when i bought tsla and at what price",
    "expectedTools": [
      "get_transactions",
      "transaction_categorize",
      "transaction_timeline"
    ],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must combine categorization and timeline analysis"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  },
  {
    "id": "market_lookup_plus_overview_plus_static-multi-step-1",
    "query": "run market data lookup for aapl, give market overview, and run static portfolio analysis",
    "expectedTools": [
      "market_data_lookup",
      "market_overview"
    ],
    "difficulty": "multi",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must orchestrate at least three steps"
    ],
    "dimensions": [
      "tool_execution",
      "correctness",
      "consistency"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 2,
    "repeatRuns": 2,
    "requireSuccessfulToolCalls": true,
    "mustContain": [],
    "mustNotContain": []
  }
];
