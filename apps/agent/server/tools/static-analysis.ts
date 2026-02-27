/**
 * Purpose: Fetch portfolio report (x-ray) from Ghostfolio and expose potential risks.
 * Inputs: client, impersonationId, token.
 * Outputs: xRay categories/rules, risks (rules where value === false), statistics, summary.
 * Failure modes: API error => structured tool error payload.
 *
 * Rule semantics: value === true means good/ok; value === false means potential issue or risk.
 */

import { GhostfolioClient } from '../ghostfolio-client';
import { logger } from '../logger';
import { toToolErrorPayload } from './tool-error';

interface XRayRule {
  key?: string;
  name?: string;
  evaluation?: string;
  value?: boolean;
  isActive?: boolean;
  configuration?: Record<string, unknown>;
}

interface XRayCategory {
  key?: string;
  name?: string;
  rules?: XRayRule[];
}

interface XRayPayload {
  categories?: XRayCategory[];
  statistics?: { rulesActiveCount?: number; rulesFulfilledCount?: number };
}

export interface StaticAnalysisRisk {
  categoryKey: string;
  categoryName: string;
  ruleKey: string;
  ruleName: string;
  evaluation: string;
}

export async function staticAnalysisTool({
  client,
  impersonationId,
  message,
  token
}: {
  client: GhostfolioClient;
  impersonationId?: string;
  message: string;
  token?: string;
}) {
  try {
    const data = await client.getPortfolioReport({ impersonationId, token });
    const xRay = (data.xRay ?? {}) as XRayPayload;
    const categories = Array.isArray(xRay.categories) ? xRay.categories : [];
    const risks: StaticAnalysisRisk[] = [];

    for (const cat of categories) {
      const categoryKey = typeof cat.key === 'string' ? cat.key : '';
      const categoryName = typeof cat.name === 'string' ? cat.name : categoryKey;
      const rules = Array.isArray(cat.rules) ? cat.rules : [];
      for (const rule of rules) {
        if (rule.value === false && rule.isActive !== false) {
          risks.push({
            categoryKey,
            categoryName,
            ruleKey: typeof rule.key === 'string' ? rule.key : '',
            ruleName: typeof rule.name === 'string' ? rule.name : '',
            evaluation: typeof rule.evaluation === 'string' ? rule.evaluation : ''
          });
        }
      }
    }

    const generatedAt = new Date().toISOString();
    const stats = xRay.statistics ?? {};
    const rulesActive = typeof stats.rulesActiveCount === 'number' ? stats.rulesActiveCount : 0;
    const rulesFulfilled = typeof stats.rulesFulfilledCount === 'number' ? stats.rulesFulfilledCount : 0;

    let summary: string;
    if (risks.length === 0) {
      summary = 'All checked rules are fulfilled; no potential risks identified.';
    } else {
      summary = `Found ${risks.length} potential risk(s) across ${risks.length ? new Set(risks.map((r) => r.categoryKey)).size : 0} categories. `;
      summary += `Rules fulfilled: ${rulesFulfilled}/${rulesActive}.`;
    }

    logger.debug('[agent-static-analysis] fetched report', {
      categoriesCount: categories.length,
      risksCount: risks.length,
      rulesActive,
      rulesFulfilled,
      timestamp: Date.now()
    });

    return {
      success: true,
      message,
      xRay: { categories, statistics: xRay.statistics },
      risks,
      statistics: { rulesActiveCount: rulesActive, rulesFulfilledCount: rulesFulfilled },
      summary,
      data_as_of: generatedAt,
      sources: ['ghostfolio_api'],
      data: data
    };
  } catch (error) {
    const toolError = toToolErrorPayload(error);
    return {
      success: false,
      answer: `Could not fetch portfolio report: ${toolError.message}`,
      summary: `Static analysis failed: ${toolError.message}`,
      error: toolError,
      data_as_of: new Date().toISOString(),
      sources: ['ghostfolio_api'],
      risks: [],
      xRay: { categories: [], statistics: { rulesActiveCount: 0, rulesFulfilledCount: 0 } }
    };
  }
}
