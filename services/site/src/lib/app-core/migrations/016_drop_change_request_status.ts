export const dropChangeRequestStatusMigration = {
  name: '016_drop_change_request_status',
  sql: `
    DROP INDEX IF EXISTS idx_change_requests_listing;

    ALTER TABLE change_requests DROP COLUMN status;

    CREATE INDEX IF NOT EXISTS idx_change_requests_listing
      ON change_requests(priority, created_at);
  `,
};
