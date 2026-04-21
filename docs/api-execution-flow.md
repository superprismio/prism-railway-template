# API Execution Flow

The API now has a first-pass execution layer for agent work on tracked change requests.

## Purpose

This is the bridge between:

- a board request that is ready for agent work
- a staging target environment
- the artifacts the active agent runtime produces while working

## New Concepts

`change_request_executions`

Each execution record captures one agent run or work attempt for a change request.

Stored fields include:

- status
- branch name
- commit SHA
- deploy URL
- adapter metadata
- summary
- error message
- arbitrary structured metadata

This gives the board a place to store real execution artifacts before we build a full deploy adapter.

## Endpoints

Protected by the same admin session or `x-admin-password` path as the board:

- `GET /api/admin/change-board/requests/:id/executions`
- `POST /api/admin/change-board/requests/:id/executions`
- `PATCH /api/admin/change-board/executions/:executionId`
- `GET /api/admin/change-board/requests/:id/deploy-plan`

## `deploy-plan`

`deploy-plan` does not redeploy yet.

It validates the selected target environment and returns the canonical staging deployment context:

- target app
- target environment
- deploy backend
- deploy config
- whether the target is currently allowed
- warnings that block or weaken execution
- the next manual action

This lets Codex, another approved agent runtime, or a human fetch one trusted plan instead of reading target config ad hoc.

## Current Adapter Mode

Current mode is `manual`.

That means:

- the API validates target state
- the API returns a deploy plan
- the active agent runtime can record execution artifacts
- actual staging redeploy is still manual

## Next Step

When `agent-target-staging` exists as the shared Railway staging service, the next implementation step is:

- add a Railway deploy adapter that consumes the existing validated deploy plan
- keep the same endpoint shape, but allow the adapter to perform the redeploy

That way the execution records and API contract do not need to change when automation is added.
