import type { OracleInput } from './types';
import { deterministicOracle } from './deterministic';

const input = (overrides: Partial<OracleInput> = {}): OracleInput => ({
  taskId: 'task-qa',
  runId: 'run-qa',
  agentId: 'producer',
  candidate: '{"total":42}',
  criteria: [{ id: 'total', field: 'total', expected: 42 }],
  evidence: [],
  ...overrides,
});

describe('deterministic Oracle', () => {
  it('verifies conformance with an independent, auditable comparison', async () => {
    const original = input();
    const verdict = await deterministicOracle.validate(original);
    expect(verdict).toMatchObject({
      status: 'VERIFIED',
      input: original,
      validator: { id: 'librechat:oracle:deterministic:v1', type: 'deterministic' },
      reasons: [{ code: 'CRITERION_MET', criterionId: 'total' }],
      checks: [{ criterionId: 'total', expected: 42, actual: 42, passed: true }],
      contradictions: [],
      uncertainty: [],
    });
    expect(Number.isNaN(Date.parse(verdict.timestamp))).toBe(false);
    original.criteria[0].expected = 99;
    expect(verdict.input.criteria[0].expected).toBe(42);
    expect(verdict.validator.id).not.toBe(original.agentId);
  });

  it.each(['{"total":41}', '{}', 'not JSON', '[42]', 'null'])(
    'rejects a demonstrated contract violation: %s',
    async (candidate) => {
      const verdict = await deterministicOracle.validate(input({ candidate }));
      expect(verdict.status).toBe('REJECTED');
      expect(verdict.reasons[0].code).toMatch(/CRITERION_FAILED|INVALID_CANDIDATE/);
    },
  );

  it.each([undefined, ''])('keeps an absent candidate unknown (%s)', async (candidate) => {
    expect((await deterministicOracle.validate(input({ candidate }))).status).toBe('UNKNOWN');
  });

  it('does not turn model agreement or high confidence into proof', async () => {
    const verdict = await deterministicOracle.validate(
      input({
        criteria: [{ id: 'total', field: 'total', expected: 42, requireEvidence: true }],
        evidence: ['model-a', 'model-b'].map((id) => ({
          id,
          criterionId: 'total',
          value: 42,
          source: { id, type: 'model' as const },
          confidence: 1,
        })),
      }),
    );
    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.uncertainty).toContain('INDEPENDENT_EVIDENCE_MISSING');
    expect(verdict.input.evidence).toHaveLength(2);
    expect((await deterministicOracle.validate(input({ criteria: [] }))).status).toBe('UNKNOWN');
  });

  it('accepts a matching independent tool check, but not producer evidence', async () => {
    const original = input({
      criteria: [{ id: 'total', field: 'total', expected: 42, requireEvidence: true }],
      evidence: [
        {
          id: 'tool-check',
          criterionId: 'total',
          value: 42,
          source: { id: 'calculator', type: 'tool', agentId: 'checker' },
        },
      ],
    });
    expect((await deterministicOracle.validate(original)).status).toBe('VERIFIED');
    original.evidence[0].source.agentId = 'producer';
    expect((await deterministicOracle.validate(original)).status).toBe('UNKNOWN');
  });

  it('preserves conflicting values and sources instead of choosing a winner', async () => {
    const original = input({
      evidence: [
        { id: 'a', criterionId: 'total', value: 42, source: { id: 'A', type: 'source' } },
        { id: 'b', criterionId: 'total', value: 43, source: { id: 'B', type: 'source' } },
      ],
    });
    const verdict = await deterministicOracle.validate(original);
    expect(verdict.status).toBe('UNKNOWN');
    expect(verdict.contradictions).toEqual([{ criterionId: 'total', evidenceIds: ['a', 'b'] }]);
    expect(verdict.input.evidence).toEqual(original.evidence);
    expect(verdict.uncertainty).toContain('CONTRADICTORY_EVIDENCE');
    expect(
      (
        await deterministicOracle.validate({
          ...original,
          review: { required: true, reason: 'policy' },
        })
      ).status,
    ).toBe('HUMAN_REVIEW');
  });

  it('preserves human review even when deterministic criteria pass', async () => {
    const verdict = await deterministicOracle.validate(
      input({
        review: { required: true, reason: 'high_risk' },
      }),
    );
    expect(verdict.status).toBe('HUMAN_REVIEW');
    expect(verdict.reasons).toContainEqual({ code: 'HUMAN_REVIEW_REQUIRED', detail: 'high_risk' });
  });

  it('does not accept self validation or ambiguous criterion identities', async () => {
    expect(
      (
        await deterministicOracle.validate(
          input({
            agentId: deterministicOracle.identity.id,
          }),
        )
      ).status,
    ).toBe('UNKNOWN');
    expect(
      (
        await deterministicOracle.validate(
          input({
            criteria: [input().criteria[0], input().criteria[0]],
          }),
        )
      ).status,
    ).toBe('UNKNOWN');
  });
});
