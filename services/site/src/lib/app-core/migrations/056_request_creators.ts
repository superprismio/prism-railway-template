import type { Migration } from './index';

export const requestCreatorsMigration: Migration = {
  name: '056_request_creators',
  sql: `
    ALTER TABLE request_origins ADD COLUMN creator_type TEXT;
    ALTER TABLE request_origins ADD COLUMN creator_id TEXT;
    ALTER TABLE request_origins ADD COLUMN creator_display_name TEXT;
    ALTER TABLE request_origins ADD COLUMN creator_basis TEXT;
    ALTER TABLE request_origins ADD COLUMN creator_agent_run_id TEXT;
    ALTER TABLE request_origins ADD COLUMN creator_parent_request_id TEXT;
    ALTER TABLE request_origins ADD COLUMN source_message_record_id TEXT;

    -- A requester's authenticated user ID was recorded at creation. A later
    -- linked session, comment, or executor is not evidence of who created it.
    UPDATE request_origins
    SET creator_type = 'user',
        creator_id = (SELECT requested_by_user_id FROM change_requests WHERE id = request_origins.request_id),
        creator_display_name = actor_display_name,
        creator_basis = 'recorded-requester-id'
    WHERE EXISTS (
      SELECT 1 FROM change_requests cr
      WHERE cr.id = request_origins.request_id AND cr.requested_by_user_id IS NOT NULL
    );

    CREATE INDEX idx_request_origins_creator
      ON request_origins(creator_type, creator_id, captured_at DESC);
  `,
};
