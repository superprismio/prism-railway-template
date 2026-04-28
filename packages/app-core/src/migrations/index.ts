import { initialMigration } from './001_initial';
import { badgeImageUrlMigration } from './002_badge_image_url';
import { targetAppsAndChangeRequestsMigration } from './003_target_apps_and_change_requests';
import { changeRequestExecutionsMigration } from './004_change_request_executions';
import { agentSessionsMigration } from './005_agent_sessions';

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
];
