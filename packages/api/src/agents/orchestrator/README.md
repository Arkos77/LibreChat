# Native mission planning MVP

`deterministicPlanner.planMission(mission, context)` describes a mission using
structured host-supplied objectives, capabilities, constraints and Oracle P5
requirements. Without explicit objectives it plans one `main` task. It does not
decompose natural language, infer permissions or call a model.

The worker is preferred whenever it covers the task's capabilities. Otherwise
the planner selects one covering specialist, preferring fewer extra capabilities
then its stable ID. Missing capabilities, ambiguous identities, duplicate task
keys, unknown dependencies and cycles fail planning. No agent is invented.
Explicit objectives determine the DAG; capability declarations alone do not
invent dependencies or a synthesis task.

Plans describe `DIRECT`, `SINGLE`, `PARALLEL`, `SEQUENTIAL` or `FANOUT_FANIN`.
Tasks retain their parent task, capabilities, all constraints and all validation
layers (mission, specialist, task). Parallel flags describe topological levels;
the native graph owns actual concurrency. Task/node identities remain stable
across plan revisions. The host must increment `planVersion` when revising a
mission and may reference `supersedesPlanId`; no replanning runtime is added.

`compileNativePlan(plan, authorizedBindings, compileOptions)` returns a native
`StandardGraphConfig` for one task or `MultiAgentGraphConfig` for several tasks.
Each destination has one direct edge with **all** dependency sources, retaining
the SDK's fan-in barrier. No execution loop, task store or scheduler is created.
The host can supply its existing durable checkpointer through compile options.

Bindings must already be resolved and authorized by the host. Models, tools and
other binding settings are retained; task objectives and constraints are added
as planning context, not enforced as authorization. SDK node IDs are task-scoped;
`actors` maps them back to saved-agent and task identities for host policy and
trace correlation. The host still owns policy hooks, admission, Task Engine
submission, settlement and durable execution state. A plan is not permission.

`validation` carries the original P5 criteria and review requirements per task,
including requests for independent evidence. The planner/compiler never produce
a verdict. The host must supply evidence and invoke P5 separately; automatic
per-member Oracle invocation in a multi-agent graph is outside this MVP. No P5
behavior is changed, no verdict is persisted and no chain-of-thought is collected.

This is an opt-in planning/configuration API, not an HTTP controller or automatic
mission submission path. A direct plan adds no specialist or delegation layer.
It does not revoke delegation tools already present in an authorized binding.
Budgets, deadlines, retry/recovery and enforcing constraints remain host concerns.
