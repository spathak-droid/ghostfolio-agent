import type { EvalCase } from '../eval-types';

export const EDGE_CASE_EVAL_CASES: EvalCase[] = [
  {
    "id": "compliance_check-edge-1",
    "query": "run a compliance check for this trade against finra suitability",
    "checkDoc": "docs/agent/compliance-regulations-us.md",
    "expectedTools": [
      "compliance_check"
    ],
    "difficulty": "edge",
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
    "mustContain": ["complian", "FINRA"],
    "mustNotContain": ["violation", "breach"]
  },
  {
    "id": "portfolio_analysis-edge-1",
    "query": "Analyze my portfolio quickly",
    "expectedTools": [
      "portfolio_analysis"
    ],
    "difficulty": "edge",
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
    "mustContain": ["portfolio"],
    "mustNotContain": ["error", "failed"]
  },
  {
    "id": "market_data-edge-1",
    "query": "how much was bitcoin price in 2025",
    "expectedTools": [
      "market_data"
    ],
    "difficulty": "edge",
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
    "mustContain": ["bitcoin", "2025"],
    "mustNotContain": ["unavailable", "no historical"]
  },
  {
    "id": "market_data_lookup-edge-1",
    "query": "get market data for AAPL",
    "expectedTools": [
      "market_data_lookup"
    ],
    "difficulty": "edge",
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
    "mustNotContain": ["no symbol", "error"]
  },
  {
    "id": "market_overview-edge-1",
    "query": "market overview",
    "expectedTools": [
      "market_overview"
    ],
    "difficulty": "edge",
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
    "mustContain": ["overview"],
    "mustNotContain": ["unavailable", "cannot"]
  },
  {
    "id": "get_transactions-edge-1",
    "query": "show me my transactions",
    "expectedTools": [
      "get_transactions"
    ],
    "difficulty": "edge",
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
    "mustNotContain": ["failed", "no access"]
  },
  {
    "id": "transaction_categorize-edge-1",
    "query": "categorize transactions",
    "expectedTools": [
      "transaction_categorize"
    ],
    "difficulty": "edge",
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
    "mustNotContain": ["error", "invalid"]
  },
  {
    "id": "transaction_timeline-edge-1",
    "query": "latest transaction for tsla",
    "expectedTools": [
      "transaction_timeline"
    ],
    "difficulty": "edge",
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
    "mustContain": ["TSLA", "latest"],
    "mustNotContain": ["not found", "no records"]
  },
  {
    "id": "create_order-edge-1",
    "query": "buy AAPL",
    "expectedTools": [
      "create_order"
    ],
    "difficulty": "edge",
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
    "id": "get_orders-edge-1",
    "query": "list orders for xyz123nonexistent",
    "expectedTools": [
      "get_orders"
    ],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must include expected output fragment"
    ],
    "dimensions": [
      "tool_execution",
      "correctness",
      "edge_cases"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["order"],
    "mustNotContain": ["error fetching", "invalid"]
  },
  {
    "id": "global-edge-general-chat",
    "query": "hello",
    "expectedTools": [],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": [
      "must route directly to llm answer",
      "must remain valid",
      "answer should include capability guidance"
    ],
    "dimensions": [
      "edge_cases",
      "correctness"
    ],
    "expectedRoute": "llm_user",
    "expectedValidity": true,
    "requireLlmAnswer": true,
    "requireLlmReasoning": true,
    "mustContain": ["portfolio", "help"],
    "mustNotContain": [
      "I bought", "error"
    ]
  },
  {
    "id": "fact_check-edge-1",
    "query": "fact check aapl quickly",
    "expectedTools": [
      "fact_check"
    ],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must return structured tool output"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["AAPL"],
    "mustNotContain": ["invalid price", "failed"]
  },
  {
    "id": "fact_compliance_check-edge-1",
    "query": "double-check and compliance check this trade for wash sale risk",
    "checkDoc": "docs/agent/compliance-regulations-us.md",
    "expectedTools": [
      "fact_compliance_check"
    ],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must keep combined intent path"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["complian", "check"],
    "mustNotContain": []
  },
  {
    "id": "holdings_analysis-edge-1",
    "query": "show holdings analysis",
    "expectedTools": [
      "holdings_analysis"
    ],
    "difficulty": "edge",
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
    "mustContain": ["holding"],
    "mustNotContain": ["error", "unavailable"]
  },
  {
    "id": "static_analysis-edge-1",
    "query": "what risks are in my portfolio? run a static analysis",
    "expectedTools": [
      "static_analysis"
    ],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": [
      "must satisfy expected route",
      "must invoke expected tools",
      "must return structured tool output"
    ],
    "dimensions": [
      "tool_execution",
      "correctness"
    ],
    "expectedRoute": "llm_tools_llm_user",
    "expectedToolCountAtLeast": 1,
    "requireSuccessfulToolCalls": true,
    "mustContain": ["risk"],
    "mustNotContain": ["unable", "error"]
  },
  {
    "id": "tax_estimate-edge-1",
    "query": "estimate my taxes from gains and dividends",
    "expectedTools": [],
    "difficulty": "edge",
    "expectedOutput": [],
    "passFailCriteria": [
      "must route directly to llm",
      "must provide tax guidance"
    ],
    "dimensions": [
      "correctness"
    ],
    "expectedValidity": true,
    "requireLlmAnswer": true,
    "mustContain": ["tax"],
    "mustNotContain": ["guaranteed", "financial advice"]
  }
];
