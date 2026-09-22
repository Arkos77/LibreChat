import { createHash } from 'crypto';
import type {
  Mission,
  MissionObjective,
  MissionPlan,
  OrchestratorPlanner,
  PlannedTask,
  PlannerContext,
} from './types';

const unique = (values: string[]): string[] => [...new Set(values)];
export const nodeIdentity = (missionId: string, key: string): string =>
  `p6_${createHash('sha256')
    .update(JSON.stringify([missionId, key]))
    .digest('hex')}`;

/** Validates dependencies and returns stable topological levels; does not schedule execution. */
export function getTaskLevels(
  tasks: Pick<MissionObjective, 'key' | 'objective' | 'dependsOn'>[],
): Map<string, number> {
  const pending = new Map(tasks.map((task) => [task.key, task]));
  if (
    tasks.length === 0 ||
    pending.size !== tasks.length ||
    tasks.some(
      (task) =>
        !task.key.trim() ||
        !task.objective.trim() ||
        new Set(task.dependsOn).size !== task.dependsOn.length ||
        task.dependsOn.some((key) => !pending.has(key)),
    )
  ) {
    throw new Error('Invalid task identities or dependencies');
  }
  const levels = new Map<string, number>();
  while (pending.size > 0) {
    let progressed = false;
    for (const [key, task] of pending) {
      if (!task.dependsOn.every((dependency) => levels.has(dependency))) {
        continue;
      }
      levels.set(
        key,
        task.dependsOn.reduce(
          (level, dependency) => Math.max(level, levels.get(dependency)! + 1),
          0,
        ),
      );
      pending.delete(key);
      progressed = true;
    }
    if (!progressed) {
      throw new Error('Cyclic task dependencies');
    }
  }
  return levels;
}

export const deterministicPlanner: OrchestratorPlanner = {
  planMission(mission, context) {
    return plan(structuredClone(mission), structuredClone(context));
  },
};

function plan(mission: Mission, context: PlannerContext): MissionPlan {
  const version = mission.planVersion ?? 1;
  if (
    !mission.missionId.trim() ||
    !mission.taskId.trim() ||
    !mission.objective.trim() ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new Error('Invalid mission identity, objective or version');
  }
  const definitions = [context.worker, ...context.specialists];
  if (
    definitions.some((s) => !s.id.trim() || !s.agentId.trim()) ||
    new Set(definitions.map((s) => s.id)).size !== definitions.length ||
    new Set(definitions.map((s) => s.agentId)).size !== definitions.length
  ) {
    throw new Error('Ambiguous specialist identity');
  }
  const objectives = mission.objectives ?? [
    {
      key: 'main',
      objective: mission.objective,
      requiredCapabilities: mission.requiredCapabilities,
      dependsOn: [],
    },
  ];
  const levels = getTaskLevels(objectives);
  const covered = new Set(objectives.flatMap((task) => task.requiredCapabilities));
  if (mission.requiredCapabilities.some((capability) => !covered.has(capability))) {
    throw new Error('Mission capability requirements missing from objectives');
  }
  const counts = new Map<number, number>();
  for (const level of levels.values()) {
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const selected = new Set<string>();
  const tasks: PlannedTask[] = objectives.map((task) => {
    const supports = (capabilities: string[]): boolean =>
      task.requiredCapabilities.every((capability) => capabilities.includes(capability));
    const specialist = supports(context.worker.capabilities)
      ? context.worker
      : [...context.specialists]
          .filter((s) => supports(s.capabilities))
          .sort(
            (a, b) => a.capabilities.length - b.capabilities.length || (a.id < b.id ? -1 : 1),
          )[0];
    if (!specialist) {
      throw new Error(`Unavailable capability for task ${task.key}`);
    }
    const isWorker = specialist.id === context.worker.id;
    if (!isWorker) {
      selected.add(specialist.id);
    }
    const validation = [mission.validation, specialist.validation, task.validation].filter(
      (requirement): requirement is NonNullable<typeof requirement> => requirement != null,
    );
    return {
      ...task,
      taskId: `${mission.taskId}/${encodeURIComponent(task.key)}`,
      parentTaskId: mission.taskId,
      nodeId: nodeIdentity(mission.missionId, task.key),
      agentId: specialist.agentId,
      specialistId: isWorker ? undefined : specialist.id,
      requiredCapabilities: unique(task.requiredCapabilities),
      constraints: unique([
        ...mission.constraints,
        ...specialist.constraints,
        ...(task.constraints ?? []),
      ]),
      validation,
      canRunInParallel: (counts.get(levels.get(task.key)!) ?? 0) > 1,
    };
  });
  const specialists = context.specialists
    .filter((s) => selected.has(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  let strategy: MissionPlan['strategy'] = specialists.length === 0 ? 'DIRECT' : 'SINGLE';
  if (tasks.length > 1) {
    strategy = 'SEQUENTIAL';
    if (tasks.some((task) => task.canRunInParallel)) {
      strategy = 'PARALLEL';
    }
    if (tasks.some((task) => task.dependsOn.length > 1)) {
      strategy = 'FANOUT_FANIN';
    }
  }
  const reasons: MissionPlan['reasons'] = [
    { code: specialists.length ? 'CAPABILITY_GAP' : 'WORKER_CAPABLE' },
  ];
  if (tasks.some((task) => task.dependsOn.length)) {
    reasons.push({ code: 'DEPENDENCY' });
  }
  if (tasks.some((task) => task.canRunInParallel)) {
    reasons.push({ code: 'PARALLEL_OPPORTUNITY' });
  }
  if (tasks.some((task) => task.validation.length)) {
    reasons.push({ code: 'VALIDATION_REQUIRED' });
  }
  return {
    planId: nodeIdentity(mission.missionId, `plan:${version}`),
    planVersion: version,
    supersedesPlanId: mission.supersedesPlanId,
    mission,
    strategy,
    tasks,
    specialists,
    reasons,
  };
}
