import { fetchRegulationTexts, fetchUrlAsText } from '../../server/regulation-fetcher';
import type { RegulationStore, RegulationTopicRow } from '../../server/stores';

describe('regulation-fetcher', () => {
  describe('fetchUrlAsText', () => {
    it('returns error on non-200 response', async () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'text/html' })
    });
      const result = await fetchUrlAsText('https://example.com/page');
      expect(result).toEqual({ error: 'HTTP 404' });
    });

    it('returns error on unsupported content-type', async () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      text: () => Promise.resolve('')
    });
      const result = await fetchUrlAsText('https://example.com/doc.pdf');
      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toContain('content-type');
    });

    it('extracts text from HTML body', async () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () =>
          Promise.resolve(
            '<html><body><p>IRS Publication 550</p><script>ignore</script></body></html>'
          )
    });
      const result = await fetchUrlAsText('https://irs.gov/p550');
      expect('text' in result).toBe(true);
      expect((result as { text: string }).text).toContain('IRS Publication 550');
      expect((result as { text: string }).text).not.toContain('ignore');
    });
  });

  describe('fetchRegulationTexts', () => {
    it('fetches and stores text for each topic URL', async () => {
      const topics: RegulationTopicRow[] = [
        {
          id: 'wash-sale',
          name: 'Wash Sale',
          key_references: ['https://example.com/wash'],
          source: 'IRS',
          rule_id: 'R-IRS-WASH-SALE',
          created_at: new Date(),
          updated_at: new Date()
        }
      ];
      const insertCalls: Array<{ topic_id: string; source_url: string; content: string }> = [];
      const store = {
        listTopics: jest.fn().mockResolvedValue(topics),
        getTopic: jest.fn(),
        getTextsByTopicId: jest.fn(),
        insertRegulationText: jest.fn().mockImplementation((p) => {
          insertCalls.push(p);
          return Promise.resolve({ id: crypto.randomUUID() });
        }),
        seedTopics: jest.fn()
      } as unknown as RegulationStore;

      (globalThis as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve('<html><body>Wash sale rule text</body></html>')
      });

      const result = await fetchRegulationTexts(store, { timeoutMs: 5000 });

      expect(result.fetched).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0].topic_id).toBe('wash-sale');
      expect(insertCalls[0].source_url).toBe('https://example.com/wash');
      expect(insertCalls[0].content).toContain('Wash sale rule text');
    });

    it('respects topicIds filter', async () => {
      const topics: RegulationTopicRow[] = [
        { id: 'wash-sale', name: 'Wash', key_references: ['https://a'], source: 'IRS', rule_id: 'R', created_at: new Date(), updated_at: new Date() },
        { id: 'other', name: 'Other', key_references: ['https://b'], source: 'IRS', rule_id: 'R', created_at: new Date(), updated_at: new Date() }
      ];
      const store = {
        listTopics: jest.fn().mockResolvedValue(topics),
        getTopic: jest.fn(),
        getTextsByTopicId: jest.fn(),
        insertRegulationText: jest.fn().mockResolvedValue({ id: crypto.randomUUID() }),
        seedTopics: jest.fn()
      } as unknown as RegulationStore;
      (globalThis as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve('<body>ok</body>')
      });

      await fetchRegulationTexts(store, { topicIds: ['wash-sale'], timeoutMs: 5000 });

      expect(store.insertRegulationText).toHaveBeenCalledTimes(1);
      expect((store.insertRegulationText as jest.Mock).mock.calls[0][0].topic_id).toBe('wash-sale');
    });
  });
});
