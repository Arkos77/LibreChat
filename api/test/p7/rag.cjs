/* Test-only bridge: runs the real host services inside the existing app network. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('../../config/credentials');
require('module-alias')({ base: path.resolve('api') });
const { uploadVectors, deleteVectors } = require('../../server/services/Files/VectorDB/crud');
const { createFileSearchTool } = require('../../app/clients/tools/util/fileSearch');
const { createRun } = require('@librechat/api');
const { FakeChatModel, Providers } = require('@librechat/agents');
const { HumanMessage } = require('@librechat/agents/langchain/messages');

async function main(input) {
  const { action, userId, fileId, query } = input;
  const req = { user: { id: userId } };
  if (action === 'ingest') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-rag-'));
    const filename = path.join(dir, 'orange17.txt');
    try {
      fs.writeFileSync(filename, input.text);
      return await uploadVectors({
        req,
        file_id: fileId,
        file: {
          path: filename,
          originalname: 'orange17.txt',
          mimetype: 'text/plain',
          size: Buffer.byteLength(input.text),
        },
      });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  }
  if (action === 'delete') {
    await deleteVectors(req, { file_id: fileId, embedded: true });
    return { deleted: true };
  }
  const search = await createFileSearchTool({
    userId,
    files: [{ file_id: fileId, filename: 'orange17.txt' }],
    maxDistance: 0.5,
  });
  if (action === 'search') {
    return await search.func({ query });
  }
  if (action !== 'run') {
    throw new Error('Unknown test action');
  }
  const consumed = [];
  class ContextReader extends FakeChatModel {
    async *_streamResponseChunks(messages, options, manager) {
      const context = messages.filter((m) => m._getType() === 'tool');
      consumed.push(context.map((m) => ({ content: m.content, tool_call_id: m.tool_call_id })));
      const text = context.map((m) => String(m.content)).join('\n');
      const answer = /couleur de validation finale soit ([\p{L}-]+)/u.exec(text)?.[1];
      const next =
        context.length === 0
          ? new FakeChatModel({
              responses: [''],
              toolCalls: [{ id: 'p7-search', name: 'file_search', args: { query } }],
            })
          : new FakeChatModel({ responses: [answer ?? 'NO_SUPPORTED_ANSWER'] });
      yield* next._streamResponseChunks(messages, options, manager);
    }
  }
  const run = await createRun({
    runId: input.runId,
    signal: new AbortController().signal,
    agents: [
      {
        id: 'p7-reader',
        name: 'P7 reader',
        provider: Providers.OPENAI,
        description: null,
        created_at: 0,
        avatar: null,
        model: 'test-model',
        tools: [search],
        model_parameters: {
          model: 'test-model',
          temperature: null,
          maxContextTokens: null,
          max_context_tokens: null,
          max_output_tokens: null,
          top_p: null,
          frequency_penalty: null,
          presence_penalty: null,
        },
      },
    ],
  });
  if (!run.Graph) throw new Error('Native graph missing');
  run.Graph.overrideModel = new ContextReader({ responses: [''] });
  await run.processStream({ messages: [new HumanMessage(query)] }, { version: 'v2' });
  const messages = run.getRunMessages();
  return {
    runId: run.id,
    consumed,
    answer: messages.at(-1)?.content,
    sources: messages
      .filter((m) => m._getType() === 'tool')
      .map((m) => ({
        tool_call_id: m.tool_call_id,
        artifact: m.artifact,
        content: m.content,
      })),
  };
}

main(JSON.parse(fs.readFileSync(0, 'utf8')))
  .then((result) => {
    console.log('P7_RESULT=' + JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    console.error('P7_ERROR=' + error.name + ':' + (error.response?.status ?? 'operation failed'));
    process.exit(1);
  });
