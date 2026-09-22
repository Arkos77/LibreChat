export type OracleStatus = 'VERIFIED' | 'REJECTED' | 'UNKNOWN' | 'HUMAN_REVIEW';
export type OracleValue = string | number | boolean | null;

/** Trusted host criteria, never inferred from the producer's confidence or instructions. */
export interface OracleCriterion {
  id: string;
  field: string;
  expected: OracleValue;
  requireEvidence?: boolean;
}

export interface OracleEvidence {
  id: string;
  criterionId: string;
  value: OracleValue;
  source: {
    id: string;
    type: 'tool' | 'source' | 'model' | 'producer';
    agentId?: string;
  };
  /** Recorded for provenance only; never sufficient to verify a result. */
  confidence?: number;
}

export interface OracleInput {
  taskId: string;
  runId?: string;
  agentId: string;
  /** Raw JSON object with scalar fields. Undefined means no candidate was produced. */
  candidate?: string;
  criteria: OracleCriterion[];
  evidence: OracleEvidence[];
  review?: { required: boolean; reason: 'high_risk' | 'policy' | 'ambiguity' };
}

export interface OracleIdentity {
  id: string;
  type: 'deterministic' | 'tool' | 'source' | 'model' | 'human';
  agentId?: string;
}

export type OracleReasonCode =
  | 'CRITERION_MET'
  | 'CRITERION_FAILED'
  | 'INVALID_CANDIDATE'
  | 'CANDIDATE_MISSING'
  | 'CRITERIA_MISSING'
  | 'INVALID_CONTRACT'
  | 'VALIDATOR_NOT_INDEPENDENT'
  | 'INDEPENDENT_EVIDENCE_MISSING'
  | 'CONTRADICTORY_EVIDENCE'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'PROVIDER_FAILED';

export interface OracleReason {
  code: OracleReasonCode;
  criterionId?: string;
  evidenceIds?: string[];
  detail?: NonNullable<OracleInput['review']>['reason'];
}

export interface OracleVerdict {
  status: OracleStatus;
  /** Snapshot of candidate, criteria, task identity and source-addressed evidence. */
  input: OracleInput;
  reasons: OracleReason[];
  checks: Array<{
    criterionId: string;
    expected: OracleValue;
    actual?: OracleValue;
    passed: boolean;
  }>;
  contradictions: Array<{ criterionId: string; evidenceIds: string[] }>;
  uncertainty: OracleReasonCode[];
  validator: OracleIdentity;
  timestamp: string;
}

/** Providers are trusted host adapters, not selected or configured by the producer. */
export interface OracleProvider {
  readonly identity: OracleIdentity;
  validate(input: OracleInput): OracleVerdict | Promise<OracleVerdict>;
}

/** QA disposition only: never a task status, permission or settlement operation. */
export type OracleDecision = 'ACCEPT' | 'REJECT' | 'DEFER' | 'REQUEST_HUMAN_REVIEW';

export type OracleEvent =
  | { phase: 'CANDIDATE' | 'VALIDATING'; input: OracleInput }
  | { phase: OracleStatus; verdict: OracleVerdict; decision: OracleDecision };

export interface OracleRunOptions extends Omit<OracleInput, 'candidate' | 'runId'> {
  provider?: OracleProvider;
  /** Host-owned consumer; this MVP does not persist verdicts or schedule review. */
  onEvent: (event: OracleEvent) => void | Promise<void>;
}
