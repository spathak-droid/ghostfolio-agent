/**
 * Purpose: Run fact_check and compliance_check together for explicit combined user intent.
 * Inputs: user message, optional symbols/regulations/order context, Ghostfolio client and optional regulation store.
 * Outputs: nested fact_check + compliance_check sections, merged sources, unified data_as_of, deterministic verdict.
 * Failure modes: one sub-check failure => partial success; both failures => success false with normalized error payload.
 */

import type { GhostfolioClient } from '../clients';
import type { RegulationStore } from '../stores';
import type { ComplianceFacts, CreateOrderParams } from '../types';
import { toToolErrorPayload } from './tool-error';
import { complianceCheckTool } from './compliance-check';
import { factCheckTool } from './fact-check';

const MAX_EXCERPT_LENGTH = 300;

interface ComplianceFindingWithExcerpt {
  message?: string;
  rule_id?: string;
  severity?: 'violation' | 'warning';
  source_url?: string;
  regulation_excerpt?: {
    excerpt: string;
    fetched_at: string;
    source_url: string;
    topic_id: string;
  };
}

export async function factComplianceCheckTool({
  client,
  createOrderParams,
  impersonationId,
  llmFactExtractor,
  message,
  regulationStore,
  regulations,
  symbols,
  token,
  type
}: {
  client: GhostfolioClient;
  createOrderParams?: CreateOrderParams;
  impersonationId?: string;
  llmFactExtractor?: (message: string) => Promise<Partial<ComplianceFacts> | undefined>;
  message: string;
  regulationStore?: RegulationStore;
  regulations?: string[];
  symbols?: string[];
  token?: string;
  type?: string;
}) {
  try {
    const [factResult, complianceResult] = await Promise.all([
      factCheckTool({
        client,
        impersonationId,
        message,
        symbols,
        token
      }),
      complianceCheckTool({
        createOrderParams: {
          ...createOrderParams,
          ...(type ? { type: type as CreateOrderParams['type'] } : {})
        },
        llmFactExtractor,
        message,
        regulations
      })
    ]);

    const enrichedCompliance = await enrichComplianceWithRegulationExcerpts({
      compliance: complianceResult,
      regulationStore
    });
    const sources = dedupeStrings([
      ...readStringArray(factResult.sources),
      ...readStringArray(complianceResult.sources),
      ...readStringArray(enrichedCompliance.regulation_excerpt_sources)
    ]);
    const dataAsOf = latestDataAsOf([factResult.data_as_of, complianceResult.data_as_of]);

    const factFailed = hasToolFailure(factResult);
    const complianceFailed = hasToolFailure(complianceResult);
    const bothFailed = factFailed && complianceFailed;
    const isFactMatch = factResult.match === true;
    const isCompliant = complianceResult.isCompliant === true;

    const answer = buildAnswer({
      bothFailed,
      complianceFailed,
      factFailed,
      isCompliant,
      isFactMatch
    });
    const summary = buildSummary({
      bothFailed,
      complianceFailed,
      factFailed,
      isCompliant,
      isFactMatch
    });

    const combinedError =
      bothFailed
        ? toToolErrorPayload(
            new Error('Both fact_check and compliance_check failed in fact_compliance_check.')
          )
        : undefined;

    return {
      success: !bothFailed,
      answer,
      summary,
      fact_check: factResult,
      compliance_check: enrichedCompliance.compliance,
      sources,
      data_as_of: dataAsOf ?? new Date().toISOString(),
      ...(combinedError ? { error: combinedError } : {})
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Fact + compliance check failed: ${toolError.message}`,
      summary: `Fact + compliance check failed: ${toolError.message}`,
      error: toolError,
      fact_check: { success: false },
      compliance_check: { success: false },
      sources: [],
      data_as_of: new Date().toISOString()
    };
  }
}

async function enrichComplianceWithRegulationExcerpts({
  compliance,
  regulationStore
}: {
  compliance: Record<string, unknown>;
  regulationStore?: RegulationStore;
}) {
  const warnings = normalizeFindings(compliance.warnings);
  const violations = normalizeFindings(compliance.violations);
  const allFindings = [...warnings, ...violations];
  if (allFindings.length === 0) {
    return { compliance, regulation_excerpt_sources: [] as string[] };
  }

  const excerptSourceUrls: string[] = [];
  const cache = new Map<string, ComplianceFindingWithExcerpt['regulation_excerpt'] | null>();
  let attachedExcerpts = 0;

  for (const finding of allFindings) {
    const ruleId = typeof finding.rule_id === 'string' ? finding.rule_id.trim() : '';
    if (!ruleId) {
      continue;
    }

    if (!cache.has(ruleId)) {
      cache.set(
        ruleId,
        await lookupRegulationExcerpt({
          regulationStore,
          ruleId
        })
      );
    }

    const excerpt = cache.get(ruleId) ?? null;
    if (!excerpt) {
      continue;
    }

    finding.regulation_excerpt = excerpt;
    excerptSourceUrls.push(excerpt.source_url);
    attachedExcerpts += 1;
  }

  const regulationTextStatus =
    attachedExcerpts > 0 ? 'available' : 'regulation_text_unavailable';

  return {
    compliance: {
      ...compliance,
      warnings,
      violations,
      regulation_text_status: regulationTextStatus
    },
    regulation_excerpt_sources: excerptSourceUrls
  };
}

async function lookupRegulationExcerpt({
  regulationStore,
  ruleId
}: {
  regulationStore?: RegulationStore;
  ruleId: string;
}): Promise<ComplianceFindingWithExcerpt['regulation_excerpt'] | null> {
  if (!regulationStore) {
    return null;
  }

  try {
    const topics = await regulationStore.listTopics();
    const topic = topics.find((item) => item.rule_id === ruleId);
    if (!topic) return null;

    const texts = await regulationStore.getTextsByTopicId(topic.id);
    const firstChunk = [...texts].sort((a, b) => a.chunk_index - b.chunk_index)[0];
    if (!firstChunk) return null;

    return {
      topic_id: topic.id,
      source_url: firstChunk.source_url,
      excerpt: normalizeExcerpt(firstChunk.content),
      fetched_at: firstChunk.fetched_at.toISOString()
    };
  } catch {
    return null;
  }
}

function normalizeFindings(items: unknown): ComplianceFindingWithExcerpt[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item): item is ComplianceFindingWithExcerpt => Boolean(item) && typeof item === 'object')
    .map((item) => ({ ...item }));
}

function normalizeExcerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_EXCERPT_LENGTH);
}

function hasToolFailure(result: Record<string, unknown>): boolean {
  if (result.success === false) {
    return true;
  }
  if (result.error && typeof result.error === 'object') {
    return true;
  }
  return false;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function latestDataAsOf(values: unknown[]): string | undefined {
  let latestTime = -1;
  let latestValue: string | undefined;

  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) {
      continue;
    }
    if (parsed > latestTime) {
      latestTime = parsed;
      latestValue = value;
    }
  }

  return latestValue;
}

function buildAnswer({
  bothFailed,
  complianceFailed,
  factFailed,
  isCompliant,
  isFactMatch
}: {
  bothFailed: boolean;
  complianceFailed: boolean;
  factFailed: boolean;
  isCompliant: boolean;
  isFactMatch: boolean;
}) {
  if (bothFailed) {
    return 'Fact and compliance checks both failed. Please retry.';
  }
  if (factFailed && !complianceFailed) {
    return 'Fact check failed, but compliance check completed.';
  }
  if (!factFailed && complianceFailed) {
    return 'Compliance check failed, but fact check completed.';
  }
  if (!isFactMatch && !isCompliant) {
    return 'Fact check found discrepancies and compliance check found blocking issues.';
  }
  if (!isFactMatch) {
    return 'Fact check found discrepancies; compliance check completed.';
  }
  if (!isCompliant) {
    return 'Fact check passed; compliance check found blocking issues.';
  }
  return 'Fact and compliance checks completed without blocking issues.';
}

function buildSummary({
  bothFailed,
  complianceFailed,
  factFailed,
  isCompliant,
  isFactMatch
}: {
  bothFailed: boolean;
  complianceFailed: boolean;
  factFailed: boolean;
  isCompliant: boolean;
  isFactMatch: boolean;
}) {
  if (bothFailed) {
    return 'Fact + compliance check failed.';
  }
  if (factFailed || complianceFailed) {
    return 'Fact + compliance check completed with partial failures.';
  }
  if (isFactMatch && isCompliant) {
    return 'Fact + compliance check completed: match=true, compliant=true.';
  }
  return `Fact + compliance check completed: match=${String(isFactMatch)}, compliant=${String(isCompliant)}.`;
}
