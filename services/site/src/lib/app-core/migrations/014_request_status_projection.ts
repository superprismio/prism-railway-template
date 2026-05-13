import type { Migration } from './index';

export const requestStatusProjectionMigration: Migration = {
  name: '014_request_status_projection',
  sql: `
    UPDATE change_requests
    SET status = CASE
      WHEN status IN ('approved', 'rejected', 'closed') THEN 'closed'
      WHEN status IN ('triaging', 'needs-human-input', 'ready-for-agent', 'in-progress', 'awaiting-review', 'changes-requested') THEN 'in-progress'
      ELSE 'submitted'
    END
    WHERE status NOT IN ('submitted', 'in-progress', 'closed');
  `,
};
