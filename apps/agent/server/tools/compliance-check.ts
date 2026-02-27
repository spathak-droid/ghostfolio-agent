import { readFileSync } from 'fs';
import { resolve } from 'path';

import type { ComplianceFacts, CreateOrderParams } from '../types';
import { toToolErrorPayload } from './tool-error';

type RuleSeverity = 'violation' | 'warning';

interface ComplianceRule {
  rule_id: string;
  severity: RuleSeverity;
  applies_when?: Record<string, unknown>;
  message?: string;
  requires?: string[];
  source_url?: string;
}

interface CompliancePolicyPack {
  jurisdiction?: string;
  policy_version?: string;
  rules?: ComplianceRule[];
}

interface ComplianceFinding {
  message: string;
  rule_id: string;
  severity: RuleSeverity;
  source_url?: string;
}

const POLICY_PACK_PATH = resolve(process.cwd(), 'docs/agent/compliance-regulations-us.md');
const DEFAULT_POLICY_VERSION = 'us-baseline-v1';
const DEFAULT_DATA_AS_OF = '2026-02-26';

/**
 * Purpose: Evaluate transaction/recommendation context against versioned policy rules.
 * Inputs: user message, optional transaction params, optional regulations allowlist.
 * Outputs: violations/warnings, compliance verdict, source metadata.
 * Failure modes: unreadable/invalid policy file => structured tool failure payload.
 */
export async function complianceCheckTool({
  createOrderParams,
  llmFactExtractor,
  message,
  policyPath = POLICY_PACK_PATH,
  regulations
}: {
  createOrderParams?: CreateOrderParams;
  llmFactExtractor?: (message: string) => Promise<Partial<ComplianceFacts> | undefined>;
  message: string;
  policyPath?: string;
  regulations?: string[];
}) {
  try {
    const policyMarkdown = readFileSync(policyPath, 'utf8');
    const policyPack = parsePolicyPack(policyMarkdown);
    const policyRuleList = Array.isArray(policyPack.rules) ? policyPack.rules : [];
    const policyVersion =
      typeof policyPack.policy_version === 'string' && policyPack.policy_version.trim().length > 0
        ? policyPack.policy_version
        : DEFAULT_POLICY_VERSION;
    const dataAsOf = readDataAsOf(policyMarkdown) ?? DEFAULT_DATA_AS_OF;
    const allowedRuleIds = normalizeRuleFilters(regulations, message);
    const knownRuleIds = new Set(policyRuleList.map((rule) => rule.rule_id));

    const warnings: ComplianceFinding[] = buildUnknownRuleWarnings({
      knownRuleIds,
      requestedRuleIds: allowedRuleIds
    });
    const violations: ComplianceFinding[] = [];
    const extractedFacts = await llmFactExtractor?.(message);
    const facts = mergeWithFallbackFacts({
      createOrderParams,
      extractedFacts,
      message
    });

    for (const rule of policyRuleList) {
      if (allowedRuleIds.length > 0 && !allowedRuleIds.includes(rule.rule_id)) {
        continue;
      }

      if (!matchesAppliesWhen(facts, rule.applies_when)) {
        continue;
      }

      const hasRequiredFacts = passesRequiredFacts(facts, rule.requires);
      const shouldRaiseFinding =
        Array.isArray(rule.requires) && rule.requires.length > 0
          ? !hasRequiredFacts
          : true;

      if (shouldRaiseFinding) {
        const finding = toFinding(rule);
        if (finding.severity === 'violation') {
          violations.push(finding);
        } else {
          warnings.push(finding);
        }
      }
    }

    const sources = [
      ...new Set([
        `policy_pack:${policyVersion}`,
        ...policyRuleList.map((rule) => rule.source_url),
        ...violations.map(({ source_url }) => source_url),
        ...warnings.map(({ source_url }) => source_url)
      ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0))
    ];
    const isCompliant = violations.length === 0;
    const summary = `Compliance check completed with ${violations.length} violation(s) and ${warnings.length} warning(s).`;
    const answer = buildComplianceNarrativeAnswer({ violations, warnings });

    return {
      success: true,
      answer,
      data_as_of: dataAsOf,
      isCompliant,
      policyVersion,
      sources,
      summary,
      violations,
      warnings
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Compliance check failed: ${toolError.message}`,
      data_as_of: new Date().toISOString(),
      error: toolError,
      policyVersion: DEFAULT_POLICY_VERSION,
      sources: ['policy_pack'],
      summary: `Compliance check failed: ${toolError.message}`,
      violations: [],
      warnings: []
    };
  }
}

function mergeWithFallbackFacts({
  createOrderParams,
  extractedFacts,
  message
}: {
  createOrderParams?: CreateOrderParams;
  extractedFacts?: Partial<ComplianceFacts>;
  message: string;
}): ComplianceFacts {
  const fallbackFacts = inferFacts({ createOrderParams, message });
  const normalizedFacts = normalizeExtractedFacts(extractedFacts);

  return {
    ...fallbackFacts,
    ...normalizedFacts,
    transaction_type: normalizedFacts.transaction_type ?? fallbackFacts.transaction_type
  };
}

function normalizeExtractedFacts(
  extractedFacts: Partial<ComplianceFacts> | undefined
): Partial<ComplianceFacts> {
  if (!extractedFacts || typeof extractedFacts !== 'object') {
    return {};
  }

  const normalized: Partial<ComplianceFacts> = {};
  if (typeof extractedFacts.concentration_risk === 'boolean') {
    normalized.concentration_risk = extractedFacts.concentration_risk;
  }
  if (typeof extractedFacts.capital_gains_topic === 'boolean') {
    normalized.capital_gains_topic = extractedFacts.capital_gains_topic;
  }
  if (typeof extractedFacts.qualified_dividends_topic === 'boolean') {
    normalized.qualified_dividends_topic = extractedFacts.qualified_dividends_topic;
  }
  if (typeof extractedFacts.tax_loss_harvesting_topic === 'boolean') {
    normalized.tax_loss_harvesting_topic = extractedFacts.tax_loss_harvesting_topic;
  }
  if (typeof extractedFacts.cost_basis_topic === 'boolean') {
    normalized.cost_basis_topic = extractedFacts.cost_basis_topic;
  }
  if (typeof extractedFacts.ira_contribution_limits_topic === 'boolean') {
    normalized.ira_contribution_limits_topic =
      extractedFacts.ira_contribution_limits_topic;
  }
  if (typeof extractedFacts.required_minimum_distributions_topic === 'boolean') {
    normalized.required_minimum_distributions_topic =
      extractedFacts.required_minimum_distributions_topic;
  }
  if (typeof extractedFacts.net_investment_income_tax_topic === 'boolean') {
    normalized.net_investment_income_tax_topic =
      extractedFacts.net_investment_income_tax_topic;
  }
  if (typeof extractedFacts.alternative_minimum_tax_topic === 'boolean') {
    normalized.alternative_minimum_tax_topic =
      extractedFacts.alternative_minimum_tax_topic;
  }
  if (typeof extractedFacts.etf_tax_efficiency_topic === 'boolean') {
    normalized.etf_tax_efficiency_topic = extractedFacts.etf_tax_efficiency_topic;
  }
  if (typeof extractedFacts.constraints === 'boolean') {
    normalized.constraints = extractedFacts.constraints;
  }
  if (typeof extractedFacts.horizon === 'boolean') {
    normalized.horizon = extractedFacts.horizon;
  }
  if (typeof extractedFacts.is_recommendation === 'boolean') {
    normalized.is_recommendation = extractedFacts.is_recommendation;
  }
  if (typeof extractedFacts.quote_is_fresh === 'boolean') {
    normalized.quote_is_fresh = extractedFacts.quote_is_fresh;
  }
  if (typeof extractedFacts.quote_staleness_check === 'boolean') {
    normalized.quote_staleness_check = extractedFacts.quote_staleness_check;
  }
  if (typeof extractedFacts.replacement_buy_signal === 'boolean') {
    normalized.replacement_buy_signal = extractedFacts.replacement_buy_signal;
  }
  if (extractedFacts.realized_pnl === 'LOSS' || extractedFacts.realized_pnl === 'GAIN') {
    normalized.realized_pnl = extractedFacts.realized_pnl;
  }
  if (typeof extractedFacts.risk_tolerance === 'boolean') {
    normalized.risk_tolerance = extractedFacts.risk_tolerance;
  }
  if (typeof extractedFacts.transaction_type === 'string' && extractedFacts.transaction_type.trim()) {
    normalized.transaction_type = extractedFacts.transaction_type.trim().toUpperCase();
  }

  return normalized;
}

function parsePolicyPack(markdown: string): CompliancePolicyPack {
  const re = /```json\s*([\s\S]*?)```/i;
  const match = re.exec(markdown);
  if (!match?.[1]) {
    throw new Error('Policy pack JSON block not found.');
  }

  const parsed = JSON.parse(match[1]) as CompliancePolicyPack;
  return parsed;
}

function readDataAsOf(markdown: string): string | undefined {
  const re = /`data_as_of`:\s*([0-9-]+)/i;
  const match = re.exec(markdown);
  return match?.[1];
}

function normalizeRuleFilters(regulations: string[] | undefined, message: string): string[] {
  const fromInput = Array.isArray(regulations)
    ? regulations.map((value) => value.trim()).filter((value) => value.length > 0)
    : [];
  const fromMessage = extractRuleIdsFromMessage(message);

  return [...new Set([...fromInput, ...fromMessage])];
}

function extractRuleIdsFromMessage(message: string): string[] {
  const matches = message.toUpperCase().match(/\bR-[A-Z0-9-]{3,64}\b/g);
  return matches ? [...new Set(matches)] : [];
}

function buildUnknownRuleWarnings({
  knownRuleIds,
  requestedRuleIds
}: {
  knownRuleIds: Set<string>;
  requestedRuleIds: string[];
}): ComplianceFinding[] {
  const warnings: ComplianceFinding[] = [];

  for (const ruleId of requestedRuleIds) {
    if (!knownRuleIds.has(ruleId)) {
      warnings.push({
        message: `Requested regulation ${ruleId} was not found in policy pack.`,
        rule_id: ruleId,
        severity: 'warning'
      });
    }
  }

  return warnings;
}

function inferFacts({
  createOrderParams,
  message
}: {
  createOrderParams?: CreateOrderParams;
  message: string;
}): ComplianceFacts {
  const normalized = message.toLowerCase();
  const quoteDate = extractFirstIsoDate(message);
  const quoteAgeDays = quoteDate ? ageInDays(quoteDate, new Date()) : undefined;
  const quoteStalenessCheck =
    /\b(quote data as of|quote as of|using quote|price as of)\b/.test(normalized) ||
    quoteDate !== undefined;

  return {
    alternative_minimum_tax_topic:
      /\b(amt|alternative minimum tax|form 6251)\b/.test(normalized),
    capital_gains_topic:
      /\b(capital gains?|short[- ]term gains?|long[- ]term gains?|schedule d)\b/.test(
        normalized
      ),
    concentration_risk:
      /\b(all (my|your) money|all-in|all in|100%|entire portfolio|one coin|single coin|single stock)\b/.test(
        normalized
      ),
    constraints:
      /\b(constraints?|restrict|restriction|no leverage|no options|no margin)\b/.test(normalized),
    cost_basis_topic:
      /\b(cost basis|basis method|fifo|lifo|average cost|specific identification)\b/.test(
        normalized
      ),
    etf_tax_efficiency_topic:
      /\b(etf tax|etf tax efficiency|in-kind creation|in-kind redemption)\b/.test(normalized),
    horizon:
      /\b(horizon|years?|months?|long term|short term)\b/.test(normalized),
    ira_contribution_limits_topic:
      /\b(ira contributions?|contribute to (my )?ira|ira limits?|traditional ira|roth ira)\b/.test(
        normalized
      ),
    is_recommendation:
      /\b(should i|recommend|what should i|advise me|buy or sell)\b/.test(normalized),
    net_investment_income_tax_topic:
      /\b(niit|net investment income tax|3\.8% surtax|form 8960)\b/.test(normalized),
    quote_is_fresh: quoteAgeDays === undefined ? undefined : quoteAgeDays <= 3,
    quote_staleness_check: quoteStalenessCheck,
    qualified_dividends_topic:
      /\b(qualified dividends?|dividend tax|topic 404)\b/.test(normalized),
    required_minimum_distributions_topic:
      /\b(required minimum distribution|rmd|publication 590-b)\b/.test(normalized),
    replacement_buy_signal:
      /\b(bought (it )?back|buy back|repurchase|re-bought|reentered)\b/.test(normalized),
    realized_pnl:
      /\bloss\b/.test(normalized) ? 'LOSS' : /\bgain\b/.test(normalized) ? 'GAIN' : undefined,
    risk_tolerance:
      /\b(risk tolerance|risk profile|conservative|moderate|aggressive)\b/.test(normalized),
    tax_loss_harvesting_topic:
      /\b(tax[- ]loss harvesting|harvest losses?|realize losses?)\b/.test(normalized),
    transaction_type: createOrderParams?.type ?? inferTransactionTypeFromMessage(normalized)
  };
}

function extractFirstIsoDate(message: string): Date | undefined {
  const re = /\b(\d{4}-\d{2}-\d{2})\b/;
  const match = re.exec(message);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

function ageInDays(input: Date, now: Date): number {
  const diffMs = now.getTime() - input.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function inferTransactionTypeFromMessage(normalizedMessage: string): string | undefined {
  if (/\bsell|sold\b/.test(normalizedMessage)) {
    return 'SELL';
  }
  if (/\bbuy|bought|purchase\b/.test(normalizedMessage)) {
    return 'BUY';
  }
  return undefined;
}

function matchesAppliesWhen(
  facts: ComplianceFacts,
  appliesWhen: Record<string, unknown> | undefined
): boolean {
  if (!appliesWhen) {
    return true;
  }

  for (const [key, value] of Object.entries(appliesWhen)) {
    const factValue = facts[key as keyof ComplianceFacts];
    if (factValue !== value) {
      return false;
    }
  }

  return true;
}

function passesRequiredFacts(facts: ComplianceFacts, required: string[] | undefined): boolean {
  if (!Array.isArray(required) || required.length === 0) {
    return true;
  }

  return required.every((field) => Boolean(facts[field as keyof ComplianceFacts]));
}

function toFinding(rule: ComplianceRule): ComplianceFinding {
  return {
    message: rule.message ?? `Rule ${rule.rule_id} check failed.`,
    rule_id: rule.rule_id,
    severity: rule.severity,
    source_url: rule.source_url
  };
}

function buildComplianceNarrativeAnswer({
  violations,
  warnings
}: {
  violations: ComplianceFinding[];
  warnings: ComplianceFinding[];
}): string {
  if (violations.length > 0) {
    const violationLines = violations.map(
      ({ message, rule_id }) => `- ${rule_id}: ${message}`
    );
    const warningLines = warnings.map(({ message, rule_id }) => `- ${rule_id}: ${message}`);
    const sections = [
      `I ran a compliance check and found ${violations.length} blocking violation(s). You should not execute this trade yet.`,
      '',
      'Violations:',
      ...violationLines
    ];
    if (warningLines.length > 0) {
      sections.push('', 'Warnings:', ...warningLines);
    }
    sections.push('', 'Next step:', '- Resolve the blocking violations before executing this trade.');
    return sections.join('\n');
  }

  if (warnings.length > 0) {
    const warningLines = warnings.map(({ message, rule_id }) => `- ${rule_id}: ${message}`);
    return [
      `I ran a compliance check and found no blocking violations, but ${warnings.length} warning(s).`,
      '',
      'Warnings:',
      ...warningLines,
      '',
      'Next step:',
      '- Review these warnings before executing the trade.'
    ].join('\n');
  }

  return [
    'I ran a compliance check and found no blocking violations or warnings.',
    '',
    'Next step:',
    '- You may proceed, but still verify position sizing and constraints.'
  ].join('\n');
}
