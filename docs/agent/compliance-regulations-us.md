# US Compliance Regulations Baseline (Agent Policy Pack v1)

`classification`: education  
`jurisdiction`: US  
`data_as_of`: 2026-02-26  
`policy_version`: us-baseline-v1

## Purpose

Use this file as a source-backed baseline for `compliance_check(transaction, regulations[])`.
The tool should map transaction/context facts to the rules below and return:
- `violations[]` (blocking)
- `warnings[]` (non-blocking)

Not legal advice.

## Runtime Use

1. Load this policy pack by `policy_version`.
2. Select rules by `jurisdiction`, account type, and transaction type.
3. Evaluate deterministic predicates.
4. Emit structured results with `rule_id`, `severity`, `reason`, `source_url`.

## Rule Catalog (Initial)

### R-SEC-REG-BI-2019
- `title`: Regulation Best Interest (broker-dealer standard of conduct)
- `trigger`: Retail recommendation flow (`is_recommendation=true`)
- `check`: If recommendation is personalized and required suitability/disclosure evidence is missing, flag.
- `severity`: warning (upgrade to violation if your product policy requires hard-block)
- `source_url`: https://www.sec.gov/rules-regulations/staff-guidance/trading-markets/regulation-best-interest

### R-FINRA-2111
- `title`: FINRA Rule 2111 (Suitability)
- `trigger`: Recommendation-like order guidance
- `check`: If user profile inputs are missing (`horizon`, `risk_tolerance`, constraints), do not produce buy/sell recommendation.
- `severity`: violation
- `source_url`: https://www.finra.org/rules-guidance/rulebooks/finra-rules/2111

### R-FINRA-3110
- `title`: FINRA Rule 3110 (Supervision)
- `trigger`: Supervisory/approval-required workflows
- `check`: If account is flagged as requiring supervision and no approval record is present, block execution.
- `severity`: violation
- `source_url`: https://www.finra.org/rules-guidance/rulebooks/finra-rules/3110

### R-FINRA-PDT
- `title`: Pattern Day Trader (minimum equity requirements)
- `trigger`: Margin account with frequent same-day round trips
- `check`: If account classified PDT and equity threshold policy fails, block day-trade order.
- `severity`: violation
- `source_url`: https://www.finra.org/investors/investing/investment-products/stocks/day-trading

### R-IRS-WASH-SALE
- `title`: IRS Wash Sale Rule
- `trigger`: Realized-loss sale with nearby substantially identical buy
- `check`: If replacement buy occurs inside configured wash-sale window, warn and label tax-impact risk.
- `severity`: warning
- `source_url`: https://www.irs.gov/publications/p550

### R-OFAC-SANCTIONS
- `title`: OFAC Sanctions Programs
- `trigger`: New counterparty/asset/country exposure (if applicable in your workflow)
- `check`: If sanctions screening result is positive or stale, block execution.
- `severity`: violation
- `source_url`: https://ofac.treasury.gov/sanctions-programs-and-country-information

## Machine-Readable Starter (for parser migration)

```json
{
  "policy_version": "us-baseline-v1",
  "jurisdiction": "US",
  "rules": [
    {
      "rule_id": "R-FINRA-2111",
      "severity": "violation",
      "applies_when": {
        "is_recommendation": true
      },
      "requires": ["risk_tolerance", "horizon", "constraints"],
      "message": "Suitability inputs are required before personalized buy/sell guidance.",
      "source_url": "https://www.finra.org/rules-guidance/rulebooks/finra-rules/2111"
    },
    {
      "rule_id": "R-IRS-WASH-SALE",
      "severity": "warning",
      "applies_when": {
        "transaction_type": "SELL",
        "realized_pnl": "LOSS",
        "replacement_buy_signal": true
      },
      "window_days": 30,
      "message": "Potential wash sale window detected; review tax treatment.",
      "source_url": "https://www.irs.gov/publications/p550"
    },
    {
      "rule_id": "R-RISK-CONCENTRATION",
      "severity": "violation",
      "applies_when": {
        "concentration_risk": true
      },
      "message": "Concentration risk is too high (single-asset/all-in posture). Diversification is required.",
      "source_url": "https://www.investor.gov/introduction-investing/investing-basics/glossary/diversification"
    },
    {
      "rule_id": "R-MARKET-DATA-STALE",
      "severity": "warning",
      "applies_when": {
        "quote_staleness_check": true
      },
      "requires": ["quote_is_fresh"],
      "message": "Quoted market data appears stale for a current trade decision; refresh prices before execution.",
      "source_url": "https://www.sec.gov/investor/pubs/tenthingstoconsider.htm"
    },
    {
      "rule_id": "R-IRS-CAPITAL-GAINS",
      "severity": "warning",
      "applies_when": {
        "capital_gains_topic": true
      },
      "message": "Capital gains treatment depends on holding period and tax lot details; confirm short-term vs long-term classification and Schedule D reporting assumptions.",
      "source_url": "https://www.irs.gov/taxtopics/tc409"
    },
    {
      "rule_id": "R-IRS-QUALIFIED-DIVIDENDS",
      "severity": "warning",
      "applies_when": {
        "qualified_dividends_topic": true
      },
      "message": "Qualified dividend tax rates require holding-period and issuer eligibility checks; verify before applying preferential rates.",
      "source_url": "https://www.irs.gov/taxtopics/tc404"
    },
    {
      "rule_id": "R-IRS-TAX-LOSS-HARVESTING",
      "severity": "warning",
      "applies_when": {
        "tax_loss_harvesting_topic": true
      },
      "message": "Tax-loss harvesting plans should verify wash-sale exposure and lot-level realization assumptions before execution.",
      "source_url": "https://www.irs.gov/publications/p550"
    },
    {
      "rule_id": "R-IRS-COST-BASIS",
      "severity": "warning",
      "applies_when": {
        "cost_basis_topic": true
      },
      "message": "Cost basis method selection (e.g., specific identification vs FIFO) materially changes taxable gains/losses; verify method and records.",
      "source_url": "https://www.irs.gov/taxtopics/tc703"
    },
    {
      "rule_id": "R-IRS-IRA-LIMITS",
      "severity": "warning",
      "applies_when": {
        "ira_contribution_limits_topic": true
      },
      "message": "IRA contribution limits and phase-out rules vary by filing status and income; validate annual eligibility before acting.",
      "source_url": "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-ira-contribution-limits"
    },
    {
      "rule_id": "R-IRS-RMD",
      "severity": "warning",
      "applies_when": {
        "required_minimum_distributions_topic": true
      },
      "message": "Required minimum distribution obligations depend on account type, age, and year-specific rules; verify applicable deadline and amount.",
      "source_url": "https://www.irs.gov/retirement-plans/retirement-plan-and-ira-required-minimum-distributions-faqs"
    },
    {
      "rule_id": "R-IRS-NIIT",
      "severity": "warning",
      "applies_when": {
        "net_investment_income_tax_topic": true
      },
      "message": "Net Investment Income Tax (3.8%) applicability depends on modified AGI thresholds and investment income definition; validate NIIT exposure.",
      "source_url": "https://www.irs.gov/individuals/net-investment-income-tax"
    },
    {
      "rule_id": "R-IRS-AMT",
      "severity": "warning",
      "applies_when": {
        "alternative_minimum_tax_topic": true
      },
      "message": "Alternative Minimum Tax treatment can differ from regular tax calculations; verify AMT applicability before estimating after-tax outcome.",
      "source_url": "https://www.irs.gov/taxtopics/tc556"
    },
    {
      "rule_id": "R-SEC-ETF-TAX-EFFICIENCY",
      "severity": "warning",
      "applies_when": {
        "etf_tax_efficiency_topic": true
      },
      "message": "ETF tax efficiency claims are product- and account-dependent; confirm distribution and turnover characteristics before relying on tax assumptions.",
      "source_url": "https://www.sec.gov/investor/pubs/sec-guide-to-etfs.htm"
    }
  ]
}
```

## Implementation Notes

- Markdown can be read by tools, but enforcement is more reliable if the tool parses only the JSON block (or a future dedicated `policies/*.json` file).
- Keep this file versioned and append-only for auditability.
