import { AIMessage } from '@librechat/agents/langchain/messages';
import type { Run, IState } from '@librechat/agents';
import type {
  OracleDecision,
  OracleInput,
  OracleRunOptions,
  OracleStatus,
  OracleVerdict,
} from './types';
import { deterministicOracle } from './deterministic';

const decisions: Record<OracleStatus, OracleDecision> = {
  VERIFIED: 'ACCEPT',
  REJECTED: 'REJECT',
  UNKNOWN: 'DEFER',
  HUMAN_REVIEW: 'REQUEST_HUMAN_REVIEW',
};

/**
 * Opt-in host completion adapter. Awaits the native stream including all stop
 * continuations; never alters its result, permissions, checkpoint or task settlement.
 * The consumer must treat ACCEPT as QA conformance, not authorization to execute.
 */
export function attachRunOracle(run: Run<IState>, options: OracleRunOptions): void {
  const { provider = deterministicOracle, onEvent, ...scope } = options;
  const trustedScope = structuredClone(scope);
  const processStream = run.processStream.bind(run);
  run.processStream = async (...args) => {
    const result = await processStream(...args);
    if (
      run.getInterrupt() != null ||
      run.getHaltReason() != null ||
      args[1].signal?.aborted ||
      run.Graph?.signal?.aborted
    ) {
      return result;
    }
    const messages = run.getRunMessages();
    const message = messages?.[messages.length - 1];
    const candidate =
      message != null &&
      AIMessage.isInstance(message) &&
      !message.tool_calls?.length &&
      typeof message.content === 'string'
        ? message.content
        : undefined;
    const input: OracleInput = { ...structuredClone(trustedScope), runId: run.id, candidate };
    await onEvent({ phase: 'CANDIDATE', input: structuredClone(input) });
    await onEvent({ phase: 'VALIDATING', input: structuredClone(input) });

    let verdict: OracleVerdict;
    const fallback = (code: 'PROVIDER_FAILED' | 'VALIDATOR_NOT_INDEPENDENT'): OracleVerdict => ({
      status: input.review?.required ? 'HUMAN_REVIEW' : 'UNKNOWN',
      input: structuredClone(input),
      validator: { ...provider.identity },
      timestamp: new Date().toISOString(),
      reasons: [{ code }],
      checks: [],
      contradictions: [],
      uncertainty: [code],
    });
    if (provider.identity.id === input.agentId || provider.identity.agentId === input.agentId) {
      verdict = fallback('VALIDATOR_NOT_INDEPENDENT');
    } else {
      try {
        verdict = await provider.validate(structuredClone(input));
        verdict = { ...structuredClone(verdict), input, validator: { ...provider.identity } };
        if (provider.identity.type === 'model' && verdict.status === 'VERIFIED') {
          verdict.status = 'UNKNOWN';
          verdict.reasons.push({ code: 'INDEPENDENT_EVIDENCE_MISSING' });
          verdict.uncertainty.push('INDEPENDENT_EVIDENCE_MISSING');
        }
        if (input.review?.required) {
          verdict.status = 'HUMAN_REVIEW';
        }
      } catch {
        verdict = fallback('PROVIDER_FAILED');
      }
    }
    await onEvent({ phase: verdict.status, verdict, decision: decisions[verdict.status] });
    return result;
  };
}
