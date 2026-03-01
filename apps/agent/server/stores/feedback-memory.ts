import type { AgentFeedbackMemory } from '../types';

interface FeedbackRow {
  answer?: string | null;
  correction?: string | null;
  trace_json?: unknown;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function sentence(value: string, max = 180): string {
  const clean = compact(value);
  if (!clean) return '';
  const stop = clean.search(/[.!?]/);
  const head = stop > 20 ? clean.slice(0, stop + 1) : clean;
  return truncate(head, max);
}

function uniquePush(list: string[], value: string): void {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

function isTraceStep(value: unknown): value is { type?: unknown; name?: unknown; output?: unknown } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTrace(value: unknown): { synthesisIssue?: string; toolIssues: string[] } {
  const toolIssues: string[] = [];
  let synthesisIssue: string | undefined;
  const steps = Array.isArray(value) ? value : [];
  for (const step of steps) {
    if (!isTraceStep(step)) continue;
    if (step.type === 'tool' && step.output && typeof step.output === 'object') {
      const output = step.output as Record<string, unknown>;
      const reason = typeof output.reason === 'string' ? output.reason : undefined;
      const error = typeof output.error === 'string' ? sentence(output.error, 120) : '';
      if (reason === 'tool_failure' || reason === 'tool_timeout') {
        const name = typeof step.name === 'string' ? step.name : 'tool';
        uniquePush(toolIssues, `${name}: ${error || reason}`);
      }
    }
    if (step.type === 'llm' && step.name === 'synthesize') {
      synthesisIssue = 'Prior syntheses were downvoted; keep summary precise and faithful to tool output.';
    }
  }
  return { synthesisIssue, toolIssues };
}

function extractTheme(text: string): string {
  // Extract main topic keywords to group related feedback
  const normalized = text.toLowerCase();
  const keywords = normalized.match(/\b(price|cost|disclaimer|warning|allocation|balance|date|include|show|hide|avoid|use|tool|timeout|error|brief|concise|detailed|disclaimer)\b/g) || [];
  if (keywords.length === 0) return text.slice(0, 30); // Fallback: use first 30 chars as theme
  // Return sorted keywords to create consistent theme key
  return [...new Set(keywords)].sort().join('|');
}

export function buildMemoryFromFeedbackRows(rows: FeedbackRow[]): AgentFeedbackMemory | undefined {
  if (!rows.length) return undefined;
  // Use Maps to keep only the newest feedback per theme (rows already ordered by created_at DESC)
  const doByTheme = new Map<string, string>();
  const dontByTheme = new Map<string, string>();
  const toolIssues: string[] = [];
  const synthesisIssues: string[] = [];

  // Process in reverse order (oldest to newest) so newer ones overwrite older ones
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    // For do's (corrections): keep newest per theme
    if (typeof row.correction === 'string' && row.correction.trim()) {
      const sentencedCorrection = sentence(row.correction);
      const theme = extractTheme(sentencedCorrection);
      // Always set (or overwrite if newer) - we process old to new, so newest wins
      doByTheme.set(theme, sentencedCorrection);
    }
    // For don'ts (bad answers): keep newest per theme
    if (typeof row.answer === 'string' && row.answer.trim()) {
      const sentencedAnswer = sentence(row.answer);
      const theme = extractTheme(sentencedAnswer);
      const formattedDont = `Avoid repeating: ${sentencedAnswer}`;
      // Always set (or overwrite if newer) - we process old to new, so newest wins
      dontByTheme.set(theme, formattedDont);
    }
    const parsedTrace = parseTrace(row.trace_json);
    for (const issue of parsedTrace.toolIssues) {
      uniquePush(toolIssues, issue);
    }
    if (parsedTrace.synthesisIssue) {
      uniquePush(synthesisIssues, parsedTrace.synthesisIssue);
    }
  }

  const memory: AgentFeedbackMemory = {
    do: Array.from(doByTheme.values()).slice(0, 3),
    dont: Array.from(dontByTheme.values()).slice(0, 2),
    sources: rows.length,
    synthesisIssues: synthesisIssues.slice(0, 2),
    toolIssues: toolIssues.slice(0, 3)
  };
  const hasSignal =
    memory.do.length > 0 ||
    memory.dont.length > 0 ||
    memory.toolIssues.length > 0 ||
    memory.synthesisIssues.length > 0;
  return hasSignal ? memory : undefined;
}

export function toFeedbackMemoryContext(memory: AgentFeedbackMemory): string {
  const lines: string[] = [];
  lines.push(`Feedback memory (${memory.sources} similar downvoted case(s)):`);
  if (memory.do.length > 0) lines.push(`Do: ${memory.do.join(' | ')}`);
  if (memory.dont.length > 0) lines.push(`Do not: ${memory.dont.join(' | ')}`);
  if (memory.toolIssues.length > 0) lines.push(`Tool issues: ${memory.toolIssues.join(' | ')}`);
  if (memory.synthesisIssues.length > 0) {
    lines.push(`Synthesis issues: ${memory.synthesisIssues.join(' | ')}`);
  }
  return lines.join('\n');
}
