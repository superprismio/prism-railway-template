import { initialMigration } from './001_initial';
import { badgeImageUrlMigration } from './002_badge_image_url';
import { targetAppsAndChangeRequestsMigration } from './003_target_apps_and_change_requests';
import { changeRequestExecutionsMigration } from './004_change_request_executions';
import { agentSessionsMigration } from './005_agent_sessions';
import { tasksMigration } from './006_tasks';
import { workflowsMigration } from './007_workflows';
import { workflowRunsMigration } from './008_workflow_runs';

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
];
