import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { deterministicRecordingHandoffMigration } from "@/lib/app-core/migrations/036_deterministic_recording_handoff";

test("recording migration does not overwrite an instance-customized workflow", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workflows (
      key TEXT PRIMARY KEY, name TEXT, description TEXT, version INTEGER,
      definition_json TEXT, system_default INTEGER, enabled INTEGER, updated_at TEXT
    );
    CREATE TABLE hooks (
      key TEXT PRIMARY KEY, description TEXT, system_default INTEGER, updated_at TEXT
    );
    INSERT INTO workflows VALUES (
      'recording-transcript-review-publish', 'Custom', 'RaidGuild custom', 14,
      '{"entrypoint":"portal"}', 0, 1, '2026-01-01'
    );
    INSERT INTO hooks VALUES (
      'recording-transcript-completed', 'Built-in hook', 1, '2026-01-01'
    );
  `);
  db.exec(deterministicRecordingHandoffMigration.sql);
  const workflow = db.prepare("SELECT version, definition_json FROM workflows WHERE key = ?")
    .get("recording-transcript-review-publish") as { version: number; definition_json: string };
  assert.equal(workflow.version, 14);
  assert.equal(JSON.parse(workflow.definition_json).entrypoint, "portal");
  db.close();
});

test("built-in recording hook prepares artifacts and creates one idempotent downstream request", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "prism-recording-handoff-"));
  process.env.PRISM_AGENT_DATA_ROOT = dataRoot;
  process.env.PRISM_MEMORY_PUBLIC_BASE_URL = "memory.example.test";
  delete process.env.PRISM_API_WRITE_KEY;
  delete process.env.PRISM_API_KEY;

  const appCore = await import("@/lib/app-core");
  const { closeDb, runMigrations } = await import("@/lib/app-core/db");
  const { readRequestArtifactFile } = await import("@/lib/app-core/request-artifact-storage");
  const { isBuiltInRecordingHook, processBuiltInRecordingHook } = await import("@/lib/recording-hook-processing");

  try {
    runMigrations();
    appCore.upsertWorkflow({
      key: "test-recording-publish",
      name: "Test recording publish",
      version: 1,
      definition: {
        key: "test-recording-publish",
        entrypoint: "closed",
        steps: [{ key: "closed", type: "terminal" }],
      },
      enabled: true,
    });
    const builtInHook = appCore.getHookByKey("recording-transcript-completed");
    assert.ok(builtInHook);
    assert.equal(isBuiltInRecordingHook(builtInHook), true);
    appCore.upsertHook({
      key: builtInHook.key,
      name: builtInHook.name,
      description: builtInHook.description,
      enabled: true,
      workflowKey: builtInHook.workflowKey,
      authMode: builtInHook.authMode,
      systemDefault: builtInHook.systemDefault,
      autoRun: builtInHook.autoRun,
      requestTemplate: {
        ...builtInHook.requestTemplate,
        constraints: {
          ...builtInHook.requestTemplate.constraints as Record<string, unknown>,
          recordingWorkflow: {
            downstreamWorkflowKey: "test-recording-publish",
            autoStartDownstream: false,
          },
        },
      },
    });

    const payload = {
      source: "discord-source-adapter",
      event: "recording.summary.completed",
      recording: {
        source: "discord-native",
        sessionId: "session-123",
        title: "Test meeting",
        endedAt: "2026-07-21T18:00:00.000Z",
      },
      transcript: {
        status: "completed",
        textOmitted: true,
        sharingAllowed: false,
      },
      summary: {
        markdown: "# Test meeting\n\nA deterministic summary.",
        json: {
          title: "Test meeting",
          tldr: "A deterministic summary.",
          summary: "The meeting was summarized upstream.",
          actionItems: [],
          tags: ["test"],
        },
        memoryPath: "inbox/memory/incoming/test-summary.json",
        artifactUrl: "/artifacts/test-summary",
      },
      policy: { rawTranscriptSharingAllowed: false },
    };

    const createParent = () => {
      const created = appCore.createChangeRequest({
        title: "Recording transcript completed",
        description: "Prepare deterministic recording artifacts.",
        workflowKey: builtInHook.workflowKey,
        requestType: "content",
        source: `hook:${builtInHook.key}`,
        constraints: {
          recordingWorkflow: {
            downstreamWorkflowKey: "test-recording-publish",
            autoStartDownstream: false,
          },
        },
      });
      assert.ok(created);
      return created;
    };
    const firstParent = createParent();
    const secondParent = createParent();
    const firstProcessing = await processBuiltInRecordingHook({ hook: builtInHook, request: firstParent, payload });
    const secondProcessing = await processBuiltInRecordingHook({ hook: builtInHook, request: secondParent, payload });

    assert.equal(firstProcessing.status, "completed");
    assert.equal(firstProcessing.childRequest?.workflowKey, "test-recording-publish");
    assert.equal(secondProcessing.childRequest?.id, firstProcessing.childRequest?.id);

    const child = firstProcessing.childRequest;
    assert.ok(child);
    const childArtifacts = appCore.listRequestArtifacts(child.id, 100);
    assert.deepEqual(
      new Set(childArtifacts.map((artifact) => artifact.name)),
      new Set([
        "meeting-summary.md",
        "meeting-summary.json",
        "transcript-reference.json",
        "memory-ingest-result.json",
        "downstream-publish-plan.json",
        "workflow-handoff.json",
      ]),
    );
    const memoryArtifact = childArtifacts.find((artifact) => artifact.name === "memory-ingest-result.json");
    assert.ok(memoryArtifact);
    const memoryResult = JSON.parse((await readRequestArtifactFile(memoryArtifact)).toString("utf8")) as Record<string, unknown>;
    assert.equal(memoryResult.reused, true);
    assert.equal(memoryResult.memoryArtifactUrl, "https://memory.example.test/artifacts/test-summary");

    const parentArtifacts = appCore.listRequestArtifacts(firstParent.id, 100);
    assert.ok(parentArtifacts.some((artifact) => artifact.name === "workflow-handoff.json"));
    assert.equal(appCore.listChangeRequests({ source: child.source }).length, 1);

    const workflowFile = await readFile(path.resolve(process.cwd(), "workflows/recording-transcript-review-publish/workflow.md"), "utf8");
    assert.match(workflowFile, /deterministic/i);
    assert.doesNotMatch(workflowFile, /steps\/synthesize\.md/);
  } finally {
    closeDb();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
