import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { getWorkflowByKey, loadConfig } from "@/lib/app-core";
import { requireServiceAccess } from "@/lib/internal-service";
import { readRouteParam } from "@/lib/local-admin-api";

type RouteContext = {
  params: Promise<{ key: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function workflowSteps(definition: Record<string, unknown>) {
  return Array.isArray(definition.steps) ? definition.steps.filter(isRecord) : [];
}

function resolveWorkflowFile(rawPath: unknown) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return null;
  }

  const config = loadConfig();
  const normalized = rawPath.trim();
  const siteWorkflowRoots = [
    path.resolve(config.workspaceRoot, "workflows"),
    path.resolve(config.repoRoot, "services/site/workflows"),
  ];
  const dataWorkflowRoot = path.resolve(config.dataRoot, "workflows");
  const candidates = path.isAbsolute(normalized)
    ? [path.resolve(normalized)]
    : [
        path.resolve(config.workspaceRoot, normalized),
        path.resolve(config.workspaceRoot, "workflows", normalized.replace(/^workflows\/+/, "")),
        path.resolve(config.repoRoot, "services/site", normalized.replace(/^\/+/, "")),
      ];
  const allowedRoots = [...siteWorkflowRoots, dataWorkflowRoot].map((allowedRoot) => {
    try {
      return fs.realpathSync(allowedRoot);
    } catch {
      return allowedRoot;
    }
  });

  const absolutePath = candidates.find((candidate) => {
    return allowedRoots.some((allowedRoot) => candidate === allowedRoot || candidate.startsWith(`${allowedRoot}${path.sep}`));
  });
  if (!absolutePath) {
    return null;
  }

  try {
    const realPath = fs.realpathSync(absolutePath);
    if (!allowedRoots.some((allowedRoot) => realPath === allowedRoot || realPath.startsWith(`${allowedRoot}${path.sep}`))) {
      return null;
    }
    return {
      path: realPath,
      content: fs.readFileSync(realPath, "utf8").trim(),
    };
  } catch {
    return {
      path: absolutePath,
      content: null,
    };
  }
}

async function requireWorkflowReadAccess() {
  return requireServiceAccess();
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireWorkflowReadAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { key } = await context.params;
  const workflow = getWorkflowByKey(readRouteParam(key));
  if (!workflow) {
    return NextResponse.json({ ok: false, error: "Workflow not found" }, { status: 404 });
  }

  const workflowFile = resolveWorkflowFile(workflow.definition.workflowPath);
  const steps = workflowSteps(workflow.definition).map((step) => {
    const instructionFile = resolveWorkflowFile(step.instructionPath);
    return {
      key: typeof step.key === "string" ? step.key : "",
      label: typeof step.label === "string" ? step.label : typeof step.name === "string" ? step.name : "",
      type: typeof step.type === "string" ? step.type : "agent",
      instructionPath: typeof step.instructionPath === "string" ? step.instructionPath : null,
      resolvedInstructionPath: instructionFile?.path ?? null,
      instructionContent: instructionFile?.content ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    workflow,
    detail: {
      workflowPath: typeof workflow.definition.workflowPath === "string" ? workflow.definition.workflowPath : null,
      resolvedWorkflowPath: workflowFile?.path ?? null,
      workflowContent: workflowFile?.content ?? null,
      steps,
    },
  });
}
