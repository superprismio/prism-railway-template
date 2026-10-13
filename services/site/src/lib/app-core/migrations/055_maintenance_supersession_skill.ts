import type { Migration } from './index';

/** Include request operations in every maintenance phase for seeded workflows. */
export const maintenanceSupersessionSkillMigration: Migration = {
  name: '055_maintenance_supersession_skill',
  sql: `
    UPDATE workflows SET definition_json=json_set(
      definition_json,
      '$.steps[0].agentConfig.skills', json('["prism-doctor","change-request-ops"]'),
      '$.steps[2].agentConfig.skills', json('["prism-doctor","change-request-ops"]'),
      '$.version', version+1
    ), version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE key='prism-maintenance' AND system_default=1
      AND json_extract(definition_json,'$.steps[0].agentConfig.skills')='["prism-doctor"]'
      AND json_extract(definition_json,'$.steps[2].agentConfig.skills')='["prism-doctor"]';
  `,
};
