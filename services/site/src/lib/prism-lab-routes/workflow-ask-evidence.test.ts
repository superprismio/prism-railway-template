import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { buildWorkflowAskEvidence, loadWorkflowInstructionEvidence } from "./workflow-ask-evidence"

test("workflow instruction loader rejects traversal and symlink escapes and bounds content", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ask-workflow-"))
  try {
    const roots = { workspaceRoot: path.join(base, "site"), repoRoot: base, dataRoot: path.join(base, "data") }
    const workflowRoot = path.join(roots.dataRoot, "workflows")
    fs.mkdirSync(workflowRoot, { recursive: true })
    const instruction = path.join(workflowRoot, "run.md")
    const secret = path.join(base, "secret")
    fs.writeFileSync(secret, "secret")
    fs.writeFileSync(instruction, "Run the sync")
    assert.equal(loadWorkflowInstructionEvidence(instruction, roots).content, "Run the sync")
    assert.equal(loadWorkflowInstructionEvidence(path.join(workflowRoot, "missing.md"), roots).status, "missing")
    assert.equal(loadWorkflowInstructionEvidence("workflows/../../secret", roots).status, "rejected")
    fs.symlinkSync(secret, path.join(workflowRoot, "link.md"))
    assert.equal(loadWorkflowInstructionEvidence(path.join(workflowRoot, "link.md"), roots).status, "rejected")
    fs.writeFileSync(instruction, "x".repeat(65 * 1024))
    assert.equal(loadWorkflowInstructionEvidence(instruction, roots).status, "oversize")
    fs.writeFileSync(instruction, "x".repeat(6_100))
    const bounded = loadWorkflowInstructionEvidence(instruction, roots)
    assert.equal(bounded.content?.length, 6_000)
    assert.equal(bounded.truncated, true)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test("instruction loader rejects an intermediate directory swapped before open", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ask-workflow-race-"))
  const originalOpen = fs.openSync
  try {
    const roots = { workspaceRoot: path.join(base, "site"), repoRoot: base, dataRoot: path.join(base, "data") }
    const workflowRoot = path.join(roots.dataRoot, "workflows")
    const safeDirectory = path.join(workflowRoot, "safe")
    const outsideDirectory = path.join(base, "outside")
    fs.mkdirSync(safeDirectory, { recursive: true })
    fs.mkdirSync(outsideDirectory)
    const instruction = path.join(safeDirectory, "run.md")
    fs.writeFileSync(instruction, "allowed text")
    fs.writeFileSync(path.join(outsideDirectory, "run.md"), "secret text")
    let swapped = false
    Object.defineProperty(fs, "openSync", { configurable: true, value: ((...args: Parameters<typeof fs.openSync>) => {
      if (!swapped) {
        swapped = true
        fs.renameSync(safeDirectory, `${safeDirectory}-original`)
        fs.symlinkSync(outsideDirectory, safeDirectory)
      }
      return originalOpen(...args)
    }) as typeof fs.openSync })
    assert.deepEqual(loadWorkflowInstructionEvidence(instruction, roots), { status: "rejected" })
    assert.equal(swapped, true)
  } finally {
    Object.defineProperty(fs, "openSync", { configurable: true, value: originalOpen })
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test("workflow evidence prioritizes current step and merges safe defaults", () => {
  const evidence = buildWorkflowAskEvidence({ definition: {
    agentConfig: { gatewayCredentials: ["evm-wallet"], contextPolicy: { continuation: "step", handoff: "artifacts" }, secret: "HIDDEN" },
    steps: [
      { key: "prepare", type: "agent" },
      { key: "run", type: "agent", instructionPath: "/data/workflows/run.md", agentConfig: { skills: ["rg-accounting-sync"], contextPolicy: { continuation: "session" } } },
    ],
  } }, "run", () => ({ status: "available", content: "Run instruction" }))
  assert.equal(evidence?.steps[0]?.key, "run")
  assert.deepEqual(evidence?.steps[0]?.agentConfig.gatewayCredentials, ["evm-wallet"])
  assert.deepEqual(evidence?.steps[0]?.agentConfig.skills, ["rg-accounting-sync"])
  assert.deepEqual(evidence?.steps[0]?.agentConfig.contextPolicy, { continuation: "session", handoff: undefined })
  assert.match(JSON.stringify(evidence?.steps[0]?.instruction), /Run instruction/)
  assert.equal(JSON.stringify(evidence).includes("HIDDEN"), false)
})
