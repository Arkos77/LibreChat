import { Providers } from '@librechat/agents';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import type { OracleEvent, OracleRunOptions, OracleStatus } from './types';
import { deterministicOracle } from './deterministic';
import { createRun } from '../run';

const makeRun = async (
  candidate: string | string[],
  onEvent: OracleRunOptions['onEvent'],
  overrides: Partial<OracleRunOptions> = {},
  steering?: Parameters<typeof createRun>[0]['steering'],
) => {
  const run = await createRun({
    runId: 'oracle-integration',
    signal: new AbortController().signal,
    steering,
    agents: [
      {
        id: 'producer',
        name: 'Producer',
        provider: Providers.OPENAI,
        description: null,
        created_at: 0,
        avatar: null,
        model: 'test-model',
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
    oracle: {
      taskId: 'task-native',
      agentId: 'producer',
      criteria: [{ id: 'answer', field: 'answer', expected: 42 }],
      evidence: [],
      onEvent,
      ...overrides,
    },
  });
  if (!run.Graph) {
    throw new Error('Native graph missing');
  }
  run.Graph.overrideTestModel(Array.isArray(candidate) ? candidate : [candidate]);
  return run;
};

describe('native run Oracle integration', () => {
  it.each<[string, OracleStatus, string]>([
    ['{"answer":42}', 'VERIFIED', 'ACCEPT'],
    ['{"answer":0}', 'REJECTED', 'REJECT'],
  ])(
    'evaluates the actual producer result %s without changing execution authority',
    async (candidate, status, decision) => {
      const events: OracleEvent[] = [];
      const run = await makeRun(candidate, (event) => {
        events.push(event);
      });
      await run.processStream(
        { messages: [new HumanMessage('Return a JSON answer.')] },
        { version: 'v2' },
      );
      expect(events.map((event) => event.phase)).toEqual(['CANDIDATE', 'VALIDATING', status]);
      expect(events[2]).toMatchObject({
        phase: status,
        decision,
        verdict: {
          input: {
            taskId: 'task-native',
            runId: 'oracle-integration',
            agentId: 'producer',
            candidate,
          },
        },
      });
      expect(run.getHaltReason()).toBeUndefined();
      expect(run.getInterrupt()).toBeUndefined();
      const messages = run.getRunMessages();
      expect(messages?.[messages.length - 1]?.content).toBe(candidate);
    },
  );

  it('keeps human review a QA disposition, not a permission or runtime halt', async () => {
    const events: OracleEvent[] = [];
    const run = await makeRun(
      '{"answer":42}',
      (event) => {
        events.push(event);
      },
      {
        review: { required: true, reason: 'policy' },
      },
    );
    await run.processStream({ messages: [new HumanMessage('Answer.')] }, { version: 'v2' });
    expect(events[events.length - 1]).toMatchObject({
      phase: 'HUMAN_REVIEW',
      decision: 'REQUEST_HUMAN_REVIEW',
    });
    expect(run.getHaltReason()).toBeUndefined();
    expect(run.getInterrupt()).toBeUndefined();
  });

  it('assesses only the final candidate after native terminal steering continues the run', async () => {
    const events: OracleEvent[] = [];
    let continued = false;
    const run = await makeRun(
      ['{"answer":0}', '{"answer":42}'],
      (event) => {
        events.push(event);
      },
      {},
      {
        hook: async () => ({}),
        terminalHook: async () => {
          if (continued) {
            return {};
          }
          continued = true;
          return { decision: 'block', additionalContext: 'Check the answer again.' };
        },
      },
    );
    await run.processStream({ messages: [new HumanMessage('Answer.')] }, { version: 'v2' });
    expect(continued).toBe(true);
    expect(events.map((event) => event.phase)).toEqual(['CANDIDATE', 'VALIDATING', 'VERIFIED']);
    expect(events[events.length - 1]).toMatchObject({
      verdict: { input: { candidate: '{"answer":42}' } },
    });
  });

  it('does not validate a policy-halted native run', async () => {
    const events: OracleEvent[] = [];
    const run = await makeRun(
      '{"answer":42}',
      (event) => {
        events.push(event);
      },
      {},
      {
        hook: async () => ({}),
        terminalHook: async () => ({ preventContinuation: true, stopReason: 'policy_halt' }),
      },
    );
    await run.processStream({ messages: [new HumanMessage('Answer.')] }, { version: 'v2' });
    expect(run.getHaltReason()).toBe('policy_halt');
    expect(events).toEqual([]);
  });

  it.each(['model', 'self', 'failed'] as const)(
    'defers an unsuitable validator (%s)',
    async (kind) => {
      const events: OracleEvent[] = [];
      let invoked = false;
      const run = await makeRun(
        '{"answer":42}',
        (event) => {
          events.push(event);
        },
        {
          provider: {
            identity: {
              id: kind === 'self' ? 'producer' : 'independent',
              type: kind === 'model' ? 'model' : 'tool',
            },
            validate: async (input) => {
              invoked = true;
              if (kind === 'failed') {
                throw new Error('private provider error must not leak');
              }
              return deterministicOracle.validate(input);
            },
          },
        },
      );
      await run.processStream({ messages: [new HumanMessage('Answer.')] }, { version: 'v2' });
      expect(events[events.length - 1]).toMatchObject({ phase: 'UNKNOWN', decision: 'DEFER' });
      expect(invoked).toBe(kind !== 'self');
      expect(JSON.stringify(events)).not.toContain('private provider error');
      expect(run.getHaltReason()).toBeUndefined();
    },
  );

  it('does not let the event consumer rewrite the trusted validation criteria', async () => {
    const events: OracleEvent[] = [];
    const run = await makeRun('{"answer":0}', (event) => {
      events.push(event);
      if ('input' in event) {
        event.input.criteria[0].expected = 0;
      }
    });
    await run.processStream({ messages: [new HumanMessage('Answer.')] }, { version: 'v2' });
    expect(events[events.length - 1]).toMatchObject({
      phase: 'REJECTED',
      verdict: { input: { criteria: [{ expected: 42 }] } },
    });
  });
  it('refuses an ambiguous producer identity at the host boundary', async () => {
    await expect(makeRun('{"answer":42}', () => {}, { agentId: 'other' })).rejects.toThrow(
      'Oracle requires one explicitly identified producer agent',
    );
  });
});
