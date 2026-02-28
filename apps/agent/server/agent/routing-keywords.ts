/**
 * Keyword hints per selectable tool; used when LLM is unavailable.
 * Registry (tool-registry) is source of truth for tool names.
 */
export const SELECTABLE_KEYWORD_HINTS: Readonly<Record<string, string[]>> = {
  fact_compliance_check: [
    'verify and compliance',
    'fact check and compliance',
    'verify and check compliance',
    'cross-check and compliance'
  ],
  fact_check: [
    'fact check',
    'verify',
    'verify price',
    'double-check',
    'confirm price',
    'cross-check'
  ],
  tax_estimate: [
    'tax estimate',
    'estimate tax',
    'calculate tax',
    'calculate my tax',
    'do my taxes',
    'do taxes',
    'my taxes',
    'capital gains tax',
    'tax liability',
    'taxes on gains',
    'dividend tax',
    'how much tax',
    'what are my taxes',
    'what is my tax',
    'what\'s my tax',
    'compute tax',
    'file taxes'
  ],
  compliance_check: [
    'compliance',
    'compliant',
    'regulation',
    'regulatory',
    'suitability',
    'finra',
    'policy check',
    'is this compliant',
    'should i buy',
    'should i sell',
    'what should i buy',
    'what should i sell',
    'is it allowed',
    'can i buy',
    'can i sell'
  ],
  portfolio_analysis: [
    'portfolio',
    'performance',
    'return',
    'net performance',
    'net worth',
    'p&l',
    'cash balance'
  ],
  holdings_analysis: [
    'allocation',
    'balance',
    'cash',
    'deposit',
    'deposited',
    'available',
    'holdings',
    'what do i hold',
    'how much do i have'
  ],
  static_analysis: [
    'potential risks',
    'portfolio risks',
    'check risks',
    'regional risk',
    'asset risk',
    'asset class risk',
    'currency risk',
    'cluster risk',
    'portfolio report',
    'x-ray',
    'static analysis',
    'emergency fund',
    'buying power',
    'fees risk'
  ],
  market_data: [
    'price of',
    'current price',
    'bitcoin price',
    'how much difference',
    'how much was',
    'price in',
    'last week',
    'last month',
    'price from today'
  ],
  analyze_stock_trend: [
    'how is my',
    'how is bitcoin doing',
    'trend',
    'doing',
    'last 7 days',
    'last 30 days',
    'past week',
    'past month'
  ],
  market_data_lookup: ['market data', 'fear and greed index'],
  market_overview: [
    'market overview',
    'market summary',
    'how are markets doing',
    'markets right now',
    'doing good',
    'doing bad',
    'market sentiment'
  ],
  transaction_categorize: ['transaction', 'categorize', 'category'],
  transaction_timeline: [
    'when did i buy',
    'what did i buy',
    'what have i bought',
    'when did i sell',
    'what did i sell',
    'what have i sold',
    'at what price',
    'last transaction',
    'latest transaction',
    'most recent transaction',
    'when i bought',
    'when i sold'
  ],
  create_order: [
    'buy',
    'purchase',
    'add activity',
    'record buy',
    'add order',
    'record a buy',
    'record a sell',
    'i want to buy',
    'i want to sell'
  ],
  create_other_activities: [
    'dividend',
    'divident',
    'fee',
    'interest',
    'liability',
    'liabilty',
    'liablity',
    'mortgage',
    'loan',
    'debt',
    'record dividend',
    'record divident',
    'record fee',
    'record interest',
    'record liability',
    'add dividend',
    'add divident',
    'add fee',
    'add interest',
    'add liability'
  ],
  get_orders: [
    'list orders',
    'list my orders',
    'find my orders',
    'orders for',
    'which orders',
    'what do you want to update'
  ]
};
