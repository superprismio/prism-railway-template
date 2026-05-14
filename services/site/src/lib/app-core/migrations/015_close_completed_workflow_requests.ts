export const closeCompletedWorkflowRequestsMigration = {
  name: '015_close_completed_workflow_requests',
  sql: `
    UPDATE change_requests
    SET completed_at = COALESCE(
          completed_at,
          (
            SELECT MAX(wr.completed_at)
            FROM workflow_runs wr
            WHERE wr.request_id = change_requests.id
              AND wr.status = 'completed'
          ),
          updated_at
        ),
        closed_at = COALESCE(
          closed_at,
          (
            SELECT MAX(wr.completed_at)
            FROM workflow_runs wr
            WHERE wr.request_id = change_requests.id
              AND wr.status = 'completed'
          ),
          updated_at
        )
    WHERE EXISTS (
        SELECT 1
        FROM workflow_runs wr
        WHERE wr.request_id = change_requests.id
          AND wr.status = 'completed'
      );
  `,
};
