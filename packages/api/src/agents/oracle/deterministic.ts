import { z } from 'zod';
import type { OracleInput, OracleProvider, OracleVerdict } from './types';

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const candidateSchema = z.record(scalar);

/** Verifies scalar JSON conformance, not the truth of unconstrained real-world claims. */
export const deterministicOracle: OracleProvider = {
  identity: { id: 'librechat:oracle:deterministic:v1', type: 'deterministic' },
  validate(input) {
    const snapshot = structuredClone(input);
    const verdict: OracleVerdict = {
      status: 'UNKNOWN',
      input: snapshot,
      validator: { ...deterministicOracle.identity },
      timestamp: new Date().toISOString(),
      reasons: [],
      checks: [],
      contradictions: [],
      uncertainty: [],
    };
    evaluate(snapshot, verdict);
    if (snapshot.review?.required === true) {
      verdict.status = 'HUMAN_REVIEW';
      verdict.reasons.push({ code: 'HUMAN_REVIEW_REQUIRED', detail: snapshot.review.reason });
    }
    return verdict;
  },
};

function evaluate(input: OracleInput, verdict: OracleVerdict): void {
  const { criteria, evidence, agentId } = input;
  const ids = new Set(criteria.map((criterion) => criterion.id));
  if (
    !input.taskId ||
    !agentId ||
    ids.size !== criteria.length ||
    criteria.some(
      (criterion) =>
        !criterion.id || !criterion.field || !scalar.safeParse(criterion.expected).success,
    ) ||
    new Set(evidence.map((item) => item.id)).size !== evidence.length ||
    evidence.some(
      (item) =>
        !item.id ||
        !item.source.id ||
        !ids.has(item.criterionId) ||
        !scalar.safeParse(item.value).success,
    )
  ) {
    verdict.reasons.push({ code: 'INVALID_CONTRACT' });
    verdict.uncertainty.push('INVALID_CONTRACT');
    return;
  }
  if (agentId === verdict.validator.id || agentId === verdict.validator.agentId) {
    verdict.reasons.push({ code: 'VALIDATOR_NOT_INDEPENDENT' });
    verdict.uncertainty.push('VALIDATOR_NOT_INDEPENDENT');
    return;
  }
  if (criteria.length === 0) {
    verdict.reasons.push({ code: 'CRITERIA_MISSING' });
    verdict.uncertainty.push('CRITERIA_MISSING');
    return;
  }

  const byCriterion = new Map<string, typeof evidence>();
  for (const item of evidence) {
    const group = byCriterion.get(item.criterionId) ?? [];
    group.push(item);
    byCriterion.set(item.criterionId, group);
  }
  for (const criterion of criteria) {
    const group = byCriterion.get(criterion.id) ?? [];
    if (group.some((item) => item.value !== criterion.expected)) {
      const contradiction = {
        criterionId: criterion.id,
        evidenceIds: group.map((item) => item.id),
      };
      verdict.contradictions.push(contradiction);
      verdict.reasons.push({ code: 'CONTRADICTORY_EVIDENCE', ...contradiction });
    }
  }
  if (verdict.contradictions.length > 0) {
    verdict.uncertainty.push('CONTRADICTORY_EVIDENCE');
    return;
  }
  if (input.candidate == null || input.candidate.trim() === '') {
    verdict.reasons.push({ code: 'CANDIDATE_MISSING' });
    verdict.uncertainty.push('CANDIDATE_MISSING');
    return;
  }
  let parsed: z.SafeParseReturnType<unknown, Record<string, z.infer<typeof scalar>>>;
  try {
    parsed = candidateSchema.safeParse(JSON.parse(input.candidate));
  } catch {
    verdict.status = 'REJECTED';
    verdict.reasons.push({ code: 'INVALID_CANDIDATE' });
    return;
  }
  if (!parsed.success) {
    verdict.status = 'REJECTED';
    verdict.reasons.push({ code: 'INVALID_CANDIDATE' });
    return;
  }

  for (const criterion of criteria) {
    const actual = Object.prototype.hasOwnProperty.call(parsed.data, criterion.field)
      ? parsed.data[criterion.field]
      : undefined;
    const passed = actual === criterion.expected;
    verdict.checks.push({
      criterionId: criterion.id,
      expected: criterion.expected,
      actual,
      passed,
    });
    verdict.reasons.push({
      code: passed ? 'CRITERION_MET' : 'CRITERION_FAILED',
      criterionId: criterion.id,
    });
    if (
      criterion.requireEvidence &&
      !(byCriterion.get(criterion.id) ?? []).some(
        (item) =>
          (item.source.type === 'tool' || item.source.type === 'source') &&
          item.source.id !== agentId &&
          item.source.agentId !== agentId &&
          item.value === criterion.expected,
      )
    ) {
      verdict.reasons.push({ code: 'INDEPENDENT_EVIDENCE_MISSING', criterionId: criterion.id });
      if (!verdict.uncertainty.includes('INDEPENDENT_EVIDENCE_MISSING')) {
        verdict.uncertainty.push('INDEPENDENT_EVIDENCE_MISSING');
      }
    }
  }
  if (verdict.checks.some((check) => !check.passed)) {
    verdict.status = 'REJECTED';
    return;
  }
  verdict.status = verdict.uncertainty.length > 0 ? 'UNKNOWN' : 'VERIFIED';
}
