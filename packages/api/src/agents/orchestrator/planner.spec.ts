import type { Mission, PlannerContext } from './types';
import { deterministicPlanner } from './planner';

const context: PlannerContext = {
  worker: {
    id: 'worker',
    agentId: 'worker',
    role: 'general',
    capabilities: ['basic'],
    constraints: [],
  },
  specialists: [
    { id: 'x', agentId: 'agent-x', role: 'X', capabilities: ['x'], constraints: ['local-only'] },
    { id: 'y', agentId: 'agent-y', role: 'Y', capabilities: ['y'], constraints: [] },
  ],
};
const mission = (overrides: Partial<Mission> = {}): Mission => ({
  missionId: 'mission',
  taskId: 'parent-task',
  objective: 'Produce a result',
  requiredCapabilities: ['basic'],
  constraints: ['no-network'],
  ...overrides,
});

describe('capability-driven planner', () => {
  it('uses the worker directly without adding specialists', () => {
    const plan = deterministicPlanner.planMission(mission(), context);
    expect(plan.strategy).toBe('DIRECT');
    expect(plan.specialists).toEqual([]);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].agentId).toBe('worker');
  });
  it('selects one specialist only for a capability gap', () => {
    const plan = deterministicPlanner.planMission(
      mission({ requiredCapabilities: ['x'] }),
      context,
    );
    expect(plan.strategy).toBe('SINGLE');
    expect(plan.specialists.map((s) => s.id)).toEqual(['x']);
    expect(plan.tasks[0].constraints).toEqual(['no-network', 'local-only']);
  });
  it.each([
    [[], 'PARALLEL'],
    [['a'], 'SEQUENTIAL'],
  ] as const)('derives strategy from dependencies %j', (dependsOn, strategy) => {
    const plan = deterministicPlanner.planMission(
      mission({
        requiredCapabilities: ['x', 'y'],
        objectives: [
          { key: 'a', objective: 'First', requiredCapabilities: ['x'], dependsOn: [] },
          { key: 'b', objective: 'Second', requiredCapabilities: ['y'], dependsOn: [...dependsOn] },
        ],
      }),
      context,
    );
    expect(plan.strategy).toBe(strategy);
    expect(plan.tasks[1].dependsOn).toEqual(dependsOn);
    expect(plan.tasks[0].canRunInParallel).toBe(strategy === 'PARALLEL');
  });
  it('preserves the diamond, validation and correlation without producing a verdict', () => {
    const validation = {
      criteria: [{ id: 'ok', field: 'ok', expected: true }],
      requireIndependentEvidence: true,
    };
    const input = mission({
      objectives: [
        { key: 'a', objective: 'Prepare', requiredCapabilities: ['basic'], dependsOn: [] },
        { key: 'b', objective: 'Branch X', requiredCapabilities: ['x'], dependsOn: ['a'] },
        { key: 'c', objective: 'Branch Y', requiredCapabilities: ['y'], dependsOn: ['a'] },
        {
          key: 'd',
          objective: 'Synthesize',
          requiredCapabilities: ['basic'],
          dependsOn: ['b', 'c'],
          validation,
        },
      ],
    });
    const plan = deterministicPlanner.planMission(input, context);
    expect(plan.strategy).toBe('FANOUT_FANIN');
    expect(plan.tasks[3].dependsOn).toEqual(['b', 'c']);
    expect(plan.tasks[3].validation).toEqual([validation]);
    expect(plan.tasks.every((t) => t.parentTaskId === 'parent-task')).toBe(true);
    expect(plan.tasks.map((t) => t.requiredCapabilities)).toEqual([
      ['basic'],
      ['x'],
      ['y'],
      ['basic'],
    ]);
    expect(new Set(plan.tasks.map((t) => t.taskId)).size).toBe(4);
    expect(plan.reasons).toContainEqual({ code: 'VALIDATION_REQUIRED' });
    expect(plan).toEqual(deterministicPlanner.planMission(input, context));
    expect(JSON.stringify(plan)).not.toMatch(/VERIFIED|REJECTED|verdict/);
  });
  it.each([
    [{ key: 'a', objective: 'A', requiredCapabilities: ['basic'], dependsOn: ['missing'] }],
    [{ key: 'a', objective: 'A', requiredCapabilities: ['basic'], dependsOn: ['a'] }],
    [
      { key: 'a', objective: 'A', requiredCapabilities: ['basic'], dependsOn: ['b'] },
      { key: 'b', objective: 'B', requiredCapabilities: ['basic'], dependsOn: ['a'] },
    ],
  ])('rejects an invalid DAG', (...objectives) => {
    expect(() => deterministicPlanner.planMission(mission({ objectives }), context)).toThrow();
  });
  it('refuses unavailable capabilities instead of inventing a specialist', () => {
    expect(() =>
      deterministicPlanner.planMission(mission({ requiredCapabilities: ['missing'] }), context),
    ).toThrow('capability');
  });
  it('retains all constraint and Oracle requirement layers without mutating inputs', () => {
    const requirement = { criteria: [{ id: 'ok', field: 'ok', expected: true }] };
    const input = mission({
      requiredCapabilities: ['x'],
      validation: requirement,
      objectives: [
        {
          key: 'one',
          objective: 'Task',
          requiredCapabilities: ['x'],
          dependsOn: [],
          constraints: ['read-only'],
          validation: { ...requirement, requireIndependentEvidence: true },
        },
      ],
    });
    const environment = structuredClone(context);
    environment.specialists[0].validation = {
      criteria: [],
      review: { required: true, reason: 'policy' },
    };
    const before = structuredClone({ input, environment });
    const plan = deterministicPlanner.planMission(input, environment);
    expect(plan.tasks[0].constraints).toEqual(['no-network', 'local-only', 'read-only']);
    expect(plan.tasks[0].validation).toEqual([
      input.validation,
      environment.specialists[0].validation,
      input.objectives![0].validation,
    ]);
    expect({ input, environment }).toEqual(before);
    plan.tasks[0].constraints.push('changed');
    expect({ input, environment }).toEqual(before);
  });
  it('keeps task identities stable across revisions while changing plan identity', () => {
    const first = deterministicPlanner.planMission(mission(), context);
    const second = deterministicPlanner.planMission(
      mission({ planVersion: 2, supersedesPlanId: first.planId }),
      context,
    );
    expect(second.planId).not.toBe(first.planId);
    expect(second.supersedesPlanId).toBe(first.planId);
    expect(second.tasks[0].taskId).toBe(first.tasks[0].taskId);
    expect(second.tasks[0].nodeId).toBe(first.tasks[0].nodeId);
  });
  it('prefers the worker even when a specialist also has the required capability', () => {
    const plan = deterministicPlanner.planMission(mission(), {
      ...context,
      specialists: [
        { id: 'extra', agentId: 'extra', role: 'extra', capabilities: ['basic'], constraints: [] },
      ],
    });
    expect(plan.specialists).toEqual([]);
  });
  it('selects deterministically independent of specialist registry order', () => {
    const alternative = {
      id: 'z',
      agentId: 'z',
      role: 'other',
      capabilities: ['x', 'other'],
      constraints: [],
    };
    const input = mission({ requiredCapabilities: ['x'] });
    expect(
      deterministicPlanner.planMission(input, {
        ...context,
        specialists: [...context.specialists, alternative],
      }),
    ).toEqual(
      deterministicPlanner.planMission(input, {
        ...context,
        specialists: [alternative, ...context.specialists].reverse(),
      }),
    );
  });
  it('rejects duplicate keys and missing mission capability coverage', () => {
    const task = { key: 'a', objective: 'A', requiredCapabilities: ['basic'], dependsOn: [] };
    expect(() =>
      deterministicPlanner.planMission(mission({ objectives: [task, task] }), context),
    ).toThrow('identities');
    expect(() =>
      deterministicPlanner.planMission(
        mission({ requiredCapabilities: ['x'], objectives: [task] }),
        context,
      ),
    ).toThrow('capability');
  });
});
