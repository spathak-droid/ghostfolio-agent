export function pruneContradictoryHoldingsFindings(findings: string[]): string[] {
  const hasNoHoldings = findings.some((line) => line.includes('No holdings found in portfolio.'));
  const hasPositiveHoldingsSignal = findings.some(
    (line) => line.startsWith('Top allocation:') || line.startsWith('Portfolio status:')
  );
  if (!hasNoHoldings || !hasPositiveHoldingsSignal) {
    return findings;
  }
  return findings.filter((line) => !line.includes('No holdings found in portfolio.'));
}

export function buildDirectAnswer({
  findings,
  riskLines,
  userMessage
}: {
  findings: string[];
  riskLines: string[];
  userMessage?: string;
}): string | undefined {
  const normalizedMessage = (userMessage ?? '').toLowerCase();
  const asksHoldingsStatus =
    /\bhow\b.*\bholding(s)?\b.*\bdoing\b/.test(normalizedMessage) ||
    /\bhow\b.*\bportfolio\b.*\bdoing\b/.test(normalizedMessage) ||
    /\bany risk\b/.test(normalizedMessage) ||
    /\brisk(s)?\b/.test(normalizedMessage);
  const asksDiversification = /\b(diverse|diversity|diversified|concentrat)\b/.test(
    normalizedMessage
  );
  if (!asksDiversification && !asksHoldingsStatus) {
    return undefined;
  }

  if (findings.some((line) => line.includes('No holdings found in portfolio.'))) {
    return asksDiversification
      ? 'Your portfolio currently has no holdings, so diversification is not applicable yet.'
      : 'Your portfolio currently has no holdings, so I cannot assess holding performance or risk yet.';
  }

  if (asksHoldingsStatus && !asksDiversification) {
    const topAllocationLine = findings.find((line) => line.startsWith('Top allocation:'));
    const statusLine = findings.find((line) => line.startsWith('Portfolio status:'));
    const topPerformerLine = findings.find((line) => line.startsWith('Top performers:'));
    const bottomPerformerLine = findings.find((line) => line.startsWith('Bottom performers:'));
    const noCriticalRisk = riskLines.some((line) =>
      line.toLowerCase().includes('no critical risks flagged')
    );
    const riskSummary = noCriticalRisk
      ? 'No critical risks were flagged by current checks.'
      : `Risk flags: ${riskLines
          .filter((line) => !line.toLowerCase().includes('no critical risks flagged'))
          .slice(0, 2)
          .join(' | ')}.`;

    const parts: string[] = [];
    if (statusLine) {
      parts.push(statusLine.replace(/^Portfolio status:\s*/i, 'Your holdings are '));
    }
    if (topAllocationLine) {
      parts.push(
        `Largest concentration is ${topAllocationLine.replace(/^Top allocation:\s*/i, '')}`
      );
    }
    if (topPerformerLine) {
      parts.push(topPerformerLine);
    }
    if (bottomPerformerLine) {
      parts.push(bottomPerformerLine);
    }
    parts.push(riskSummary);
    return parts.join(' ');
  }

  const topAllocationLine = findings.find((line) => line.startsWith('Top allocation:'));
  if (!topAllocationLine) {
    return 'I could not determine diversification from the available holdings data.';
  }

  const percentages = [...topAllocationLine.matchAll(/(\d+(?:\.\d+)?)%/g)].map((match) =>
    Number(match[1])
  );
  if (percentages.length === 0) {
    return 'I could not determine diversification from the available holdings data.';
  }

  const top1 = percentages[0] ?? 0;
  const top3 = percentages.slice(0, 3).reduce((sum, value) => sum + value, 0);

  if (top1 >= 50) {
    return `Your portfolio is highly concentrated; your largest position is ${roundTwo(
      top1
    )}% and top 3 positions are ${roundTwo(top3)}%.`;
  }
  if (top1 >= 35) {
    return `Your portfolio is concentrated; your largest position is ${roundTwo(
      top1
    )}% and top 3 positions are ${roundTwo(top3)}%.`;
  }
  if (top1 >= 20) {
    return `Your portfolio is moderately concentrated; your largest position is ${roundTwo(
      top1
    )}% and top 3 positions are ${roundTwo(top3)}%.`;
  }

  return `Your portfolio appears fairly diversified; your largest position is ${roundTwo(
    top1
  )}% and top 3 positions are ${roundTwo(top3)}%.`;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatDataAsOfLines(dataAsOf?: string): string[] {
  if (!dataAsOf) {
    return ['Date: unknown', 'Time: unknown', 'Timezone: unknown'];
  }

  const isoPattern =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/;
  const isoMatch = isoPattern.exec(dataAsOf);
  if (isoMatch) {
    return [
      `Date: ${isoMatch[1]}`,
      `Time: ${isoMatch[2]}`,
      `Timezone: ${isoMatch[3]}`
    ];
  }

  const parsed = new Date(dataAsOf);
  if (Number.isNaN(parsed.getTime())) {
    return [`Raw: ${dataAsOf}`];
  }

  return [
    `Date: ${parsed.toISOString().slice(0, 10)}`,
    `Time: ${parsed.toISOString().slice(11, 23)}`,
    'Timezone: Z'
  ];
}

export function shouldIncludeDataFreshnessSection(dataAsOf?: string): boolean {
  if (!dataAsOf) {
    return true;
  }

  const parsed = new Date(dataAsOf);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  const dataDateUtc = parsed.toISOString().slice(0, 10);
  return dataDateUtc !== todayUtc;
}
