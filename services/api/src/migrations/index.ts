import { initialMigration } from './001_initial.js';
import { badgeImageUrlMigration } from './002_badge_image_url.js';
import { targetAppsAndChangeRequestsMigration } from './003_target_apps_and_change_requests.js';
import { changeRequestExecutionsMigration } from './004_change_request_executions.js';
import { agentSessionsMigration } from './005_agent_sessions.js';

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
