import type { OracleInput } from '../oracle/types';

/** Requirements only. Evidence and verdicts belong to Oracle at execution time. */
export interface OracleRequirement {
  criteria: OracleInput['criteria'];
  review?: OracleInput['review'];
  requireIndependentEvidence?: boolean;
}

export interface MissionObjective {
  key: string;
  objective: string;
  requiredCapabilities: string[];
  dependsOn: string[];
  constraints?: string[];
  validation?: OracleRequirement;
}

/** Structured, host-supplied intent; no natural-language decomposition in this MVP. */
export interface Mission {
  missionId: string;
  taskId: string;
  objective: string;
  constraints: string[];
  requiredCapabilities: string[];
  objectives?: MissionObjective[];
  validation?: OracleRequirement;
  planVersion?: number;
  supersedesPlanId?: string;
}

/** Capability declarations are selection hints, never execution permissions. */
export interface SpecialistDefinition {
  id: string;
  agentId: string;
  role: string;
  capabilities: string[];
  constraints: string[];
  validation?: OracleRequirement;
}

export interface PlannerContext {
  worker: SpecialistDefinition;
  specialists: SpecialistDefinition[];
}

export interface PlannedTask extends Omit<MissionObjective, 'constraints' | 'validation'> {
  taskId: string;
  parentTaskId: string;
  /** SDK node identity; the authorized saved agent remains agentId. */
  nodeId: string;
  agentId: string;
  specialistId?: string;
  constraints: string[];
  validation: OracleRequirement[];
  canRunInParallel: boolean;
}

export interface MissionPlan {
  planId: string;
  planVersion: number;
  supersedesPlanId?: string;
  mission: Mission;
  strategy: 'DIRECT' | 'SINGLE' | 'PARALLEL' | 'SEQUENTIAL' | 'FANOUT_FANIN';
  tasks: PlannedTask[];
  specialists: SpecialistDefinition[];
  reasons: Array<{
    code:
      | 'WORKER_CAPABLE'
      | 'CAPABILITY_GAP'
      | 'DEPENDENCY'
      | 'PARALLEL_OPPORTUNITY'
      | 'VALIDATION_REQUIRED';
  }>;
}

export interface OrchestratorPlanner {
  planMission(mission: Mission, context: PlannerContext): MissionPlan;
}
