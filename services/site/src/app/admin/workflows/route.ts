import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { listWorkflows, loadConfig, upsertWorkflow } from "@/lib/app-core";
import { requireLocalAdminAccess } from "@/lib/local-admin-api";

export async function GET() {
  const access = await requireLocalAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  return NextResponse.json({ ok: true, workflows: listWorkflows() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseKey(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function validWorkflowKey(key: string) {
  return /^[a-z0-9][a-z0-9-]{1,80}[a-z0-9]$/.test(key);
}

function validateWorkflowPaths(definition: Record<string, unknown>, workflowRoot: string) {
  const paths: string[] = [];
  if (typeof definition.workflowPath === "string") {
    paths.push(definition.workflowPath);
  }
  if (Array.isArray(definition.steps)) {
    for (const step of definition.steps) {
      if (isRecord(step) && typeof step.instructionPath === "string") {
        paths.push(step.instructionPath);
      }
    }
  }

  for (const rawPath of paths) {
    const resolved = path.resolve(rawPath);
    if (resolved !== workflowRoot && !resolved.startsWith(`${workflowRoot}${path.sep}`)) {
      return false;
    }
  }
  return true;
}

export async function POST(request: Request) {
  const access = await requireLocalAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const body = isRecord(payload) ? payload : {};
  const key = parseKey(body.key);
  if (!validWorkflowKey(key)) {
    return NextResponse.json({ ok: false, error: "Invalid workflow key" }, { status: 400 });
  }

  const config = loadConfig();
  const workflowRoot = path.resolve(config.dataRoot, "workflows", key);
  const manifestPath = path.resolve(workflowRoot, "manifest.proposal.json");
  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json({ ok: false, error: `Workflow manifest not found at ${manifestPath}` }, { status: 404 });
  }

  let manifest: unknown = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return NextResponse.json({ ok: false, error: "Workflow manifest is not valid JSON" }, { status: 400 });
  }

  if (!isRecord(manifest)) {
    return NextResponse.json({ ok: false, error: "Workflow manifest must be an object" }, { status: 400 });
  }
  if (manifest.key !== key) {
    return NextResponse.json({ ok: false, error: "Workflow manifest key does not match requested key" }, { status: 400 });
  }
  if (!Array.isArray(manifest.steps) || !manifest.steps.length) {
    return NextResponse.json({ ok: false, error: "Workflow manifest must include steps" }, { status: 400 });
  }
  if (!validateWorkflowPaths(manifest, workflowRoot)) {
    return NextResponse.json({ ok: false, error: "Workflow paths must stay under the workflow volume directory" }, { status: 400 });
  }

  const workflow = upsertWorkflow({
    key,
    name: typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : key,
    description: typeof manifest.description === "string" ? manifest.description : null,
    version: typeof manifest.version === "number" && Number.isFinite(manifest.version) ? manifest.version : 1,
    definition: manifest,
    systemDefault: false,
    enabled: body.enabled === false ? false : true,
  });

  return NextResponse.json({ ok: true, workflow }, { status: 201 });
}
