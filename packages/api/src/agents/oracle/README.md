# Oracle MVP

`createRun({ ..., oracle })` opts one explicitly identified producer into QA.
The host supplies `taskId`, `agentId`, scalar equality `criteria`, `evidence`,
an optional `review` requirement, and an `onEvent` consumer.
Criteria and source identities are trusted host configuration: never copy them
from the producer's response or untrusted request metadata.

After the native `processStream` finishes (including terminal steering), the
adapter takes the last assistant text as the JSON candidate and emits
`CANDIDATE → VALIDATING → verdict`. Paused, halted and failed runs are not
validated. Missing/non-text final results produce `UNKNOWN`, not a verdict
on an earlier assistant message. No model reasoning is extracted.

The deterministic provider compares a flat JSON object with scalar criteria.
Its comparison records prove **conformance to those criteria**, not arbitrary
real-world truth. A criterion can additionally require independent tool/source
evidence. Producer evidence and model opinions do not satisfy that requirement;
confidence never affects acceptance. Conflicts with criteria or between sources
remain `UNKNOWN`; an explicit risk/policy/ambiguity requirement takes precedence
as `HUMAN_REVIEW`. All inputs, evidence and contradictions remain in the verdict.

`OracleProvider` permits future trusted adapters. A model-only provider cannot
return an accepted result. A failed or non-independent validator defers QA.
Evidence authenticity remains the supplying host adapter's responsibility.

The consumer receives `ACCEPT`, `REJECT`, `DEFER` or `REQUEST_HUMAN_REVIEW` as a
**QA disposition**, not permission or task status. Task Engine, authorization,
settlement and checkpoint ownership are unchanged. Consumer failures propagate
to the caller; they must not be interpreted as a successful validation.

This MVP is opt-in, has no new store or review scheduler, and does not wire an
HTTP endpoint, persist verdicts, evaluate multi-agent graph outputs, or validate
each delegated child automatically. A consumer can retain the verdict using its
existing result/metadata path. No dedicated BOT MODE entry point exists in this
checkout; integration uses the existing host `createRun` boundary.
