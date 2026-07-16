import { initialMigration } from './001_initial';
import { badgeImageUrlMigration } from './002_badge_image_url';
import { targetAppsAndChangeRequestsMigration } from './003_target_apps_and_change_requests';
import { changeRequestExecutionsMigration } from './004_change_request_executions';
import { agentSessionsMigration } from './005_agent_sessions';
import { tasksMigration } from './006_tasks';
import { workflowsMigration } from './007_workflows';
import { workflowRunsMigration } from './008_workflow_runs';
import { nullableRequestTargetsMigration } from './009_nullable_request_targets';
import { requestArtifactsMigration } from './010_request_artifacts';
import { requestExternalRefsMigration } from './011_request_external_refs';
import { userInvitesMigration } from './012_user_invites';
import { hooksMigration } from './013_hooks';
import { closeCompletedWorkflowRequestsMigration } from './015_close_completed_workflow_requests';
import { dropChangeRequestStatusMigration } from './016_drop_change_request_status';
import { changeRequestPrReviewCheckpointMigration } from './017_change_request_pr_review_checkpoint';
import { agentResponseJobsMigration } from './018_agent_response_jobs';
import { taskScriptsMigration } from './019_task_scripts';
import { hookRunsMigration } from './020_hook_runs';
import { agentRunsMigration } from './021_agent_runs';
import { runLinksMigration } from './022_run_links';
import { requestArtifactRunLinksMigration } from './023_request_artifact_run_links';
import { requestHumanHoursEstimateMigration } from './024_request_human_hours_estimate';
import { agentRunQueueFieldsMigration } from './025_agent_run_queue_fields';
import { skillSourcesMigration } from './026_skill_sources';
import { simpleChangeRequestReviewGateMigration } from './027_simple_change_request_review_gate';
import { recordingTranscriptWorkflowMigration } from './028_recording_transcript_workflow';
import { recordingTranscriptPortalMemoryMigration } from './029_recording_transcript_portal_memory';
import { recordingWorkflowDownstreamHandoffMigration } from './030_recording_workflow_downstream_handoff';
import { runtimeProfilesMigration } from './031_runtime_profiles';
import { compactRecordingHookPayloadMigration } from './032_compact_recording_hook_payload';
import { workflowEventSequenceMigration } from './033_workflow_event_sequence';
import { externalInteractionsMigration } from './034_external_interactions';
import { interactionMemoryInstructionsMigration } from './035_interaction_memory_instructions';

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  initialMigration,
  badgeImageUrlMigration,
  targetAppsAndChangeRequestsMigration,
  changeRequestExecutionsMigration,
  agentSessionsMigration,
  tasksMigration,
  workflowsMigration,
  workflowRunsMigration,
  nullableRequestTargetsMigration,
  requestArtifactsMigration,
  requestExternalRefsMigration,
  userInvitesMigration,
  hooksMigration,
  closeCompletedWorkflowRequestsMigration,
  dropChangeRequestStatusMigration,
  changeRequestPrReviewCheckpointMigration,
  agentResponseJobsMigration,
  taskScriptsMigration,
  hookRunsMigration,
  agentRunsMigration,
  runLinksMigration,
  requestArtifactRunLinksMigration,
  requestHumanHoursEstimateMigration,
  agentRunQueueFieldsMigration,
  skillSourcesMigration,
  simpleChangeRequestReviewGateMigration,
  recordingTranscriptWorkflowMigration,
  recordingTranscriptPortalMemoryMigration,
  recordingWorkflowDownstreamHandoffMigration,
  runtimeProfilesMigration,
  compactRecordingHookPayloadMigration,
  workflowEventSequenceMigration,
  externalInteractionsMigration,
  interactionMemoryInstructionsMigration,
];
