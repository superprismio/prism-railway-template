import type { Migration } from './index';

/** Add request operations to the original, unmodified maintenance seed only. */
export const maintenanceRequestRecoverySkillMigration: Migration = {
  name: '054_maintenance_request_recovery_skill',
  sql: `
    UPDATE workflows
    SET definition_json = json_set(
      definition_json,
      '$.steps[1].agentConfig.skills',
      json('["prism-workflow-author","prism-skill-author","prism-gateway-author","change-request-ops"]')
    ), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE key = 'prism-maintenance' AND system_default = 1
      AND json_extract(definition_json, '$.steps[1].agentConfig.skills')
        = '["prism-workflow-author","prism-skill-author","prism-gateway-author"]';
  `,
};
