import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

interface Source {
  fileId: string;
  documentId: string;
  chunkId?: string;
  content: string;
  distance: number;
  source: string;
}
type SearchResult = [string, { file_search: { sources: Source[] } } | null];
interface Row {
  uuid: string;
  custom_id: string;
  document: string;
  dimensions: number;
  cmetadata: { file_id: string; user_id: string; source: string };
}

/** Explicit opt-in: uses the existing Docker network, never creates services. */
const integration = process.env.P7_RAG_E2E === '1' ? describe : describe.skip;
integration('P7 native RAG → context → run with durable pgvector evidence', () => {
  const fileId = randomUUID();
  const userId = `p7-${randomUUID()}`;
  const text = 'Le protocole ORANGE-17 impose que la couleur de validation finale soit indigo.';
  const query = 'Quelle couleur de validation finale impose le protocole ORANGE-17 ?';
  const call = <T>(action: string, extra: object = {}): T => {
    const output = execFileSync(
      'docker',
      [
        'exec',
        '-i',
        '--user',
        '1000:1000',
        '-w',
        '/workspaces',
        'librechat_devcontainer-app-1',
        'node',
        'api/test/p7/rag.cjs',
      ],
      {
        input: JSON.stringify({ action, fileId, userId, query, ...extra }),
        encoding: 'utf8',
        timeout: 90000,
      },
    );
    const result = output.split('\n').find((line) => line.startsWith('P7_RESULT='));
    if (!result) throw new Error('Native bridge returned no evidence');
    return JSON.parse(result.slice('P7_RESULT='.length)) as T;
  };
  const rows = (): Row[] =>
    JSON.parse(
      execFileSync(
        'docker',
        [
          'exec',
          'vectordb',
          'psql',
          '-U',
          'myuser',
          '-d',
          'mydatabase',
          '-At',
          '-c',
          `SELECT coalesce(json_agg(t),'[]'::json) FROM (SELECT uuid, custom_id, document, cmetadata, vector_dims(embedding) AS dimensions FROM langchain_pg_embedding WHERE cmetadata->>'file_id' = '${fileId}') t`,
        ],
        { encoding: 'utf8' },
      ),
    ) as Row[];

  beforeAll(() => {
    assert.equal(call<{ embedded: boolean }>('ingest', { text }).embedded, true);
  }, 100000);
  afterAll(() => {
    call('delete');
    assert.deepEqual(rows(), []);
  }, 100000);

  it('reads persisted chunks and 384-dimensional embeddings, then retrieves their source', () => {
    const stored = rows();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((r) => r.dimensions === 384)).toBe(true);
    expect(stored[0]).toMatchObject({ custom_id: fileId, cmetadata: { file_id: fileId } });
    expect(stored.map((r) => r.document).join(' ')).toContain(text);
    const [, artifact] = call<SearchResult>('search');
    expect(artifact?.file_search.sources.length).toBeGreaterThan(0);
    const hit = artifact!.file_search.sources[0];
    expect(hit).toMatchObject({
      fileId,
      documentId: fileId,
      content: expect.stringContaining('indigo'),
    });
    expect(
      stored.some((r) => r.document === hit.content && r.cmetadata.source === hit.source),
    ).toBe(true);
    if (hit.chunkId) expect(stored.some((r) => r.uuid === hit.chunkId)).toBe(true);
    expect(hit.distance).toBeLessThanOrEqual(0.5);
  });

  it('consumes retrieved ToolMessage context inside the native host run, retaining provenance', () => {
    const result = call<{
      runId: string;
      answer: string;
      consumed: Array<Array<{ content: string }>>;
      sources: Array<{ tool_call_id: string; artifact: { file_search: { sources: Source[] } } }>;
    }>('run', { runId: `p7-${fileId}` });
    expect(result.answer).toBe('indigo');
    expect(result.consumed.flat().some((m) => m.content.includes(text))).toBe(true);
    expect(result.sources[0].tool_call_id).toBe('p7-search');
    expect(result.sources[0].artifact.file_search.sources[0]).toMatchObject({
      fileId,
      documentId: fileId,
    });
    expect(result.runId).toBe(`p7-${fileId}`);
  }, 100000);

  it('returns no invented retrieval for a nonexistent document', () => {
    const [content, artifact] = call<SearchResult>('search', { fileId: randomUUID() });
    expect(artifact).toBeNull();
    expect(content).not.toContain('indigo');
  });

  it('does not attach false provenance to an irrelevant query', () => {
    const [content, artifact] = call<SearchResult>('search', {
      query: 'How many moons orbit Jupiter and what are their masses?',
    });
    expect(artifact).toBeNull();
    expect(content).not.toContain('indigo');
  });

  it('does not retrieve the document under a different authenticated user scope', () => {
    const [content, artifact] = call<SearchResult>('search', {
      userId: `p7-other-${randomUUID()}`,
    });
    expect({ owners: [...new Set(rows().map((r) => r.cmetadata.user_id))], artifact }).toEqual({
      owners: [userId],
      artifact: null,
    });
    expect(content).not.toContain('indigo');
  });
});
