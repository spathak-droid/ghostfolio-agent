import {
  buildMemoryFromFeedbackRows,
  toFeedbackMemoryContext
} from '../../server/stores';

describe('feedback-memory', () => {
  it('builds structured memory from downvoted rows', () => {
    const memory = buildMemoryFromFeedbackRows([
      {
        answer: 'Summary looked generic and missed totals.',
        correction: 'Include holdings value, cash, and total value first.',
        trace_json: [
          {
            type: 'tool',
            name: 'market_data_lookup',
            output: { reason: 'tool_failure', error: 'timeout from upstream' }
          },
          { type: 'llm', name: 'synthesize' }
        ]
      }
    ]);

    expect(memory).toBeDefined();
    expect(memory?.do[0]).toContain('Include holdings value');
    expect(memory?.dont[0]).toContain('Avoid repeating');
    expect(memory?.toolIssues[0]).toContain('market_data_lookup');
    expect(memory?.synthesisIssues.length).toBeGreaterThan(0);
  });

  it('formats feedback memory into compact context text', () => {
    const text = toFeedbackMemoryContext({
      do: ['Lead with totals.'],
      dont: ['Avoid generic opening.'],
      sources: 2,
      synthesisIssues: ['Keep synthesis faithful to tool output.'],
      toolIssues: ['market_data_lookup: timeout']
    });

    expect(text).toContain('Feedback memory (2 similar downvoted case(s))');
    expect(text).toContain('Do:');
    expect(text).toContain('Do not:');
    expect(text).toContain('Tool issues:');
  });
});
