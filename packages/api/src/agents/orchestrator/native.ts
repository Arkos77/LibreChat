import type { AgentInputs, MultiAgentGraphConfig, StandardGraphConfig } from '@librechat/agents';
import type { MissionPlan, OracleRequirement } from './types';
import { getTaskLevels, nodeIdentity } from './planner';

export interface NativeMissionPlan {
  planId: string;
  missionId: string;
  graphConfig: StandardGraphConfig | MultiAgentGraphConfig;
  actors: Array<{ nodeId: string; agentId: string; taskId: string }>;
  validation: Array<{ taskId: string; nodeId: string; requirements: OracleRequirement[] }>;
}

/**
 * Compiles descriptions only. Bindings must already be resolved/authorized by
 * the host; this adapter neither grants access nor starts tasks or runs.
 * Compile options (including the existing durable checkpointer) stay host-owned.
 */
export function compileNativePlan(
  plan: MissionPlan,
  bindings: ReadonlyMap<string, AgentInputs>,
  compileOptions?: MultiAgentGraphConfig['compileOptions'],
): NativeMissionPlan {
  getTaskLevels(plan.tasks);
  const tasks = new Map(plan.tasks.map((task) => [task.key, task]));
  const agents = plan.tasks.map((task): AgentInputs => {
    const binding = bindings.get(task.agentId);
    if (!binding || binding.agentId !== task.agentId) {
      throw new Error(`Missing or mismatched authorized binding for ${task.agentId}`);
    }
    if (task.nodeId !== nodeIdentity(plan.mission.missionId, task.key)) {
      throw new Error('Invalid native task identity');
    }
    return {
      ...binding,
      agentId: task.nodeId,
      instructions: [
        binding.instructions,
        'Mission planning context (not execution permission):',
        JSON.stringify({
          missionId: plan.mission.missionId,
          taskId: task.taskId,
          missionObjective: plan.mission.objective,
          objective: task.objective,
          constraints: task.constraints,
          requiredCapabilities: task.requiredCapabilities,
        }),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  });
  const edges: MultiAgentGraphConfig['edges'] = plan.tasks
    .filter((task) => task.dependsOn.length > 0)
    .map((task) => ({
      from: task.dependsOn.map((key) => tasks.get(key)!.nodeId),
      to: task.nodeId,
      edgeType: 'direct',
    }));
  return {
    planId: plan.planId,
    missionId: plan.mission.missionId,
    actors: plan.tasks.map(({ nodeId, agentId, taskId }) => ({ nodeId, agentId, taskId })),
    graphConfig:
      agents.length === 1
        ? { type: 'standard', agents, compileOptions }
        : { type: 'multi-agent', agents, edges, compileOptions },
    validation: plan.tasks
      .filter((task) => task.validation.length > 0)
      .map((task) => ({
        taskId: task.taskId,
        nodeId: task.nodeId,
        requirements: structuredClone(task.validation),
      })),
  };
}
