import type { AgentFeedbackMemory } from './types';

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

export function buildMemoryFromFeedbackRows(rows: FeedbackRow[]): AgentFeedbackMemory | undefined {
  if (!rows.length) return undefined;
  const doList: string[] = [];
  const dontList: string[] = [];
  const toolIssues: string[] = [];
  const synthesisIssues: string[] = [];

  for (const row of rows) {
    if (typeof row.correction === 'string' && row.correction.trim()) {
      uniquePush(doList, sentence(row.correction));
    }
    if (typeof row.answer === 'string' && row.answer.trim()) {
      uniquePush(dontList, `Avoid repeating: ${sentence(row.answer)}`);
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
    do: doList.slice(0, 3),
    dont: dontList.slice(0, 2),
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
