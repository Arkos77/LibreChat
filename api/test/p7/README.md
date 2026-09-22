# P7 native RAG evidence

Run from the repository root with the existing devcontainer and RAG services:

```sh
P7_RAG_E2E=1 ./node_modules/.bin/jest --config packages/api/jest.config.mjs packages/api/src/files/rag.integration.spec.ts --runInBand
./node_modules/.bin/jest --config api/jest.config.js api/test/app/clients/tools/util/fileSearch.test.js --runInBand
```

The opt-in integration test uses `uploadVectors` (multipart `/embed`), the real
parser/embedding service, direct readback of `langchain_pg_embedding`, and the
native `file_search` tool inside host `createRun`. A unique synthetic file and
scope are created for each invocation; cleanup deletes only that file and checks
that its rows disappeared. Existing services and configuration are not changed.

The external language model is replaced by a test-only deterministic reader. It
requests `file_search`, then extracts the answer from the actual ToolMessage
received by the native graph. It has no preprogrammed color response. This proves
context transport/consumption, not a live provider's grounding quality. Sources
are recovered from the native ToolMessage artifact and associated with the run
and tool-call identity. Store UUIDs prove durable chunk identity even when the
RAG endpoint does not return chunk IDs.

`maxDistance: 0.5` is an explicit pgvector cosine-distance retrieval policy for
this test. Existing callers retain their current behavior unless they opt into
a cutoff. It is not a truth-confidence threshold or a general relevance guarantee.
Missing source metadata, mismatched document identity, and nonfinite distances
are excluded. A failed file request must not shift later source identities.

Authentication must be active in RAG with credentials matching LibreChat for the
user-isolation gate to pass. An unauthenticated/public-scope deployment is not an
isolation proof. No signing key or user credential is embedded in these tests.

RAG supplies contextual evidence only: the Task Engine executes, the Orchestrator
plans, and the Oracle validates. Retrieved text is not verified truth, similarity
is not truth confidence, and retrieved context is not durable agent memory. No
second runtime/store, reasoning trace, or verdict mechanism is added.
