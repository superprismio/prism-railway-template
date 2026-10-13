import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { getChangeRequest, getChangeRequestByNumber, getWorkflowByKey, getWorkflowRunForRequest } from './repository';

export interface SupersededRequestInput {
  targetRequestId: string;
  successorRequestNumbers: number[];
  evidenceArtifactIds: string[];
  expectedWorkflowRunId: string;
  expectedStepKey: string;
  expectedWorkflowVersion: number;
  maintenanceRequestId: string;
  maintenanceAgentRunId: string;
  comment: string;
  dryRun: boolean;
}

function sameSet<T extends string | number>(left: T[] | undefined, right: T[]) {
  const sortedLeft = [...(left ?? [])].sort();
  const sortedRight = [...right].sort();
  return Array.isArray(left) && left.length === right.length &&
    new Set(left).size === left.length && new Set(right).size === right.length &&
    sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** A bounded alternative to the admin's force-cancel operation. No active work is interrupted. */
export function cancelSupersededRequest(input: SupersededRequestInput) {
  const db = getDb();
  return db.transaction(() => {
    const target = getChangeRequest(input.targetRequestId);
    if (!target) return { ok: false, error: 'REQUEST_NOT_FOUND' };
    const run = getWorkflowRunForRequest(target.id);
    if (!run) return { ok: false, error: 'WORKFLOW_RUN_NOT_FOUND' };
    const previous = db.prepare(`SELECT payload_json FROM workflow_events WHERE request_id=? AND event_type='workflow.canceled_superseded' ORDER BY created_at DESC LIMIT 1`).get(target.id) as { payload_json: string } | undefined;
    if (run.status === 'canceled' && previous) {
      const prior = JSON.parse(previous.payload_json) as { successorRequestNumbers?: number[]; evidenceArtifactIds?: string[]; maintenanceRequestId?: string; maintenanceAgentRunId?: string };
      const sameProof = prior.maintenanceRequestId === input.maintenanceRequestId &&
        prior.maintenanceAgentRunId === input.maintenanceAgentRunId &&
        sameSet(prior.successorRequestNumbers, input.successorRequestNumbers) &&
        sameSet(prior.evidenceArtifactIds, input.evidenceArtifactIds);
      return sameProof
        ? { ok: true, dryRun: input.dryRun, duplicate: true, targetRequestNumber: target.requestNumber }
        : { ok: false, error: 'ALREADY_CANCELED_WITH_OTHER_PROOF' };
    }
    const blockers: string[] = [];
    if (target.closedAt || run.status !== 'active') blockers.push('TARGET_NOT_OPEN');
    if (run.id !== input.expectedWorkflowRunId || run.currentStepKey !== input.expectedStepKey) blockers.push('WORKFLOW_STATE_CHANGED');
    const workflow = getWorkflowByKey(target.workflowKey);
    if (!workflow || workflow.version !== input.expectedWorkflowVersion) blockers.push('WORKFLOW_VERSION_CHANGED');
    const steps = Array.isArray(workflow?.definition.steps) ? workflow.definition.steps : [];
    const step = steps.find((candidate) => candidate && typeof candidate === 'object' && candidate.key === run.currentStepKey);
    if (!step || step.type === 'gate' || step.type === 'human' || step.type === 'terminal') blockers.push('HUMAN_OR_TERMINAL_STEP');
    const terminal = steps.find((candidate) => candidate && typeof candidate === 'object' && candidate.type === 'terminal');
    if (!terminal || typeof terminal.key !== 'string') blockers.push('TERMINAL_STEP_MISSING');
    if (!target.source.startsWith('task:') || target.source.length <= 5) blockers.push('NOT_SCHEDULED_TASK_SOURCE');
    const activeAgent = db.prepare(`SELECT id FROM agent_runs WHERE request_id=? AND status IN ('queued','claimed','running','canceling','completing') LIMIT 1`).get(target.id);
    const activeScript = db.prepare(`SELECT id FROM workflow_script_runs WHERE request_id=? AND status IN ('queued','running','canceling','completing') LIMIT 1`).get(target.id);
    if (activeAgent || activeScript) blockers.push('ACTIVE_WORK');
    const maintenance = getChangeRequest(input.maintenanceRequestId);
    if (!maintenance || maintenance.workflowKey !== 'prism-maintenance' || maintenance.id === target.id) blockers.push('INVALID_MAINTENANCE_REQUEST');
    const maintenanceWorkflowRun = maintenance ? getWorkflowRunForRequest(maintenance.id) : null;
    const maintenanceRun = db.prepare(`SELECT ar.id FROM agent_runs ar JOIN agent_profiles ap ON ap.id=ar.agent_profile_id WHERE ar.id=? AND ar.request_id=? AND ar.workflow_run_id=? AND ar.kind='workflow_step' AND ar.workflow_step_key='repair' AND ar.status IN ('running','completing','succeeded') AND ap.key='dreamer-agent'`).get(input.maintenanceAgentRunId, input.maintenanceRequestId, maintenanceWorkflowRun?.id ?? '');
    if (!maintenanceRun || !maintenanceWorkflowRun || maintenanceWorkflowRun.status !== 'active' || maintenanceWorkflowRun.currentStepKey !== 'repair' || maintenance?.closedAt) blockers.push('INVALID_MAINTENANCE_AGENT_RUN');
    const numbers = [...new Set(input.successorRequestNumbers)];
    if (!numbers.length || numbers.length !== input.successorRequestNumbers.length) blockers.push('SUCCESSORS_REQUIRED');
    const successors = numbers.map((number) => getChangeRequestByNumber(number));
    if (successors.some((successor) => !successor || successor.requestNumber <= target.requestNumber || successor.createdAt <= target.createdAt || successor.source !== target.source || successor.workflowKey !== target.workflowKey || successor.targetAppId !== target.targetAppId || successor.targetEnvironmentId !== target.targetEnvironmentId || successor.workflowRunStatus !== 'completed' || !successor.closedAt)) blockers.push('SUCCESSOR_NOT_EQUIVALENT_AND_COMPLETED');
    const allowedIds = new Set([target.id, input.maintenanceRequestId, ...successors.filter((successor) => successor).map((successor) => successor!.id)]);
    const artifactIds = [...new Set(input.evidenceArtifactIds)];
    if (!artifactIds.length || artifactIds.length !== input.evidenceArtifactIds.length) blockers.push('EVIDENCE_REQUIRED');
    const artifacts = artifactIds.map((id) => db.prepare('SELECT request_id FROM request_artifacts WHERE id=?').get(id) as { request_id: string } | undefined);
    if (artifacts.some((artifact) => !artifact || !allowedIds.has(artifact.request_id)) || !artifacts.some((artifact) => artifact?.request_id === target.id) || !artifacts.some((artifact) => successors.some((successor) => successor?.id === artifact?.request_id))) blockers.push('EVIDENCE_ARTIFACTS_INVALID');
    if (!input.comment.trim()) blockers.push('COMMENT_REQUIRED');
    if (blockers.length) return { ok: false, dryRun: input.dryRun, blockers, targetRequestNumber: target.requestNumber };
    const preview = { ok: true, dryRun: input.dryRun, duplicate: false, targetRequestNumber: target.requestNumber, successorRequestNumbers: numbers, evidenceArtifactIds: artifactIds, terminalStepKey: terminal!.key };
    if (input.dryRun) return preview;
    const now = new Date().toISOString();
    const note = input.comment.trim();
    db.prepare(`UPDATE workflow_runs SET current_step_key=?,status='canceled',completed_at=?,updated_at=? WHERE id=? AND status='active' AND current_step_key=?`).run(terminal!.key, now, now, run.id, input.expectedStepKey);
    db.prepare(`UPDATE change_requests SET resolution_summary=?,completed_at=COALESCE(completed_at,?),closed_at=COALESCE(closed_at,?),updated_at=? WHERE id=? AND closed_at IS NULL`).run(note, now, now, now, target.id);
    db.prepare(`INSERT INTO workflow_events (id,workflow_run_id,request_id,step_key,event_type,actor_type,actor_id,note,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), run.id, target.id, terminal!.key, 'workflow.canceled_superseded', 'agent', input.maintenanceAgentRunId, note, JSON.stringify({ previousStepKey: run.currentStepKey, successorRequestNumbers: numbers, evidenceArtifactIds: artifactIds, maintenanceRequestId: input.maintenanceRequestId, maintenanceAgentRunId: input.maintenanceAgentRunId }), now);
    return { ...preview, dryRun: false };
  })();
}
