import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { config } from "./config.js";
import { createNativePrismSkillHome, credentialRequirementsFromSkillMarkdown, extractSkillBundleFromArchive, requestedSkillNames } from "./prism-skills.js";

async function skillArchive(entries: Array<{ name: string; content?: string; type?: "file" | "directory" }>) {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    pack.on("end", () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on("error", reject);
  });
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      pack.entry({ name: entry.name, type: entry.type ?? "file" }, entry.content ?? "", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  pack.finalize();
  return await completed;
}

test("skill frontmatter accepts credential assignment metadata", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: analytics-report
metadata:
  gateway-credentials: [plausible-production]
---
`), ["plausible-production"]);
});

test("invalid credential keys are ignored", () => {
  assert.deepEqual(credentialRequirementsFromSkillMarkdown(`---
name: unsafe
metadata:
  gateway-credentials: [sendgrid, "../../secret", "bad key"]
---
`), ["sendgrid"]);
});

test("Buzz channel administration requests load the protected admin skill", () => {
  assert.ok(requestedSkillNames("Create a private Buzz channel for delivery").includes("prism-buzz-channel-admin"));
  assert.ok(requestedSkillNames("Add this member to the channel", { transport: "buzz" }).includes("prism-buzz-channel-admin"));
  assert.equal(requestedSkillNames("Summarize this channel", { transport: "buzz" }).includes("prism-buzz-channel-admin"), false);
});

test("exact skill selection does not infer skills from workflow prompt text", () => {
  assert.deepEqual(
    requestedSkillNames("Run this workflow step, record the result, and deploy it", {
      requestedSkills: ["portal-publisher"],
      skillSelectionMode: "exact",
    }),
    ["portal-publisher"],
  );
  assert.deepEqual(
    requestedSkillNames("Run this workflow step and record the result", {
      requestedSkills: [],
      skillSelectionMode: "exact",
    }),
    [],
  );
});

test("hosted skill archives preserve scripts and references for native Codex discovery", async () => {
  const archive = await skillArchive([
    { name: "portal-ops/", type: "directory" },
    { name: "portal-ops/SKILL.md", content: "---\nname: portal-ops\ndescription: Operate Portal.\n---\n" },
    { name: "portal-ops/scripts/publish.sh", content: "#!/bin/sh\n" },
    { name: "portal-ops/references/routes.md", content: "# Routes\n" },
  ]);

  const bundle = await extractSkillBundleFromArchive(archive, "portal-ops");
  assert.match(bundle.content, /name: portal-ops/);
  assert.deepEqual(bundle.files.map((file) => file.path), [
    "SKILL.md",
    "scripts/publish.sh",
    "references/routes.md",
  ]);
});

test("native skill home reports only confirmed installed selected SKILL.md paths", async () => {
  const archive = await skillArchive([
    { name: "portal-ops/SKILL.md", content: "---\nname: portal-ops\ndescription: Operate Portal.\n---\n" },
  ]);
  const originalHome = await fs.mkdtemp(path.join(os.tmpdir(), "prism-skill-test-"));
  const originalFetch = globalThis.fetch;
  const originalBase = config.appApiBaseUrl;
  const originalToken = config.appServiceToken;
  config.appApiBaseUrl = "https://skills.example";
  config.appServiceToken = "test-token";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/agent/skills")) {
      return Response.json({ skills: [{ name: "portal-ops", downloadPath: "/agent/skills/portal-ops/download" }] });
    }
    if (String(url).endsWith("/agent/skills/portal-ops/download")) {
      return new Response(new Uint8Array(archive));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const home = await createNativePrismSkillHome(originalHome, {
      availableSkills: [{ name: "portal-ops", path: "", description: "", requiredCredentials: [], source: "app-api" }],
      selectedSkills: [{ name: "portal-ops", content: "selected", requiredCredentials: [] }],
    }, { skillSelectionMode: "exact" });
    try {
      const skillPath = home.selectedSkillPaths.get("portal-ops");
      if (!skillPath) throw new Error("Selected skill was not installed");
      assert.ok(skillPath.startsWith(home.path));
      assert.match(await fs.readFile(skillPath, "utf8"), /Operate Portal/);
      assert.equal(home.skillCount, 1);
      assert.equal(home.selectedSkillPaths.size, 1);
    } finally {
      await home.cleanup();
    }
  } finally {
    globalThis.fetch = originalFetch;
    config.appApiBaseUrl = originalBase;
    config.appServiceToken = originalToken;
    await fs.rm(originalHome, { recursive: true, force: true });
  }
});

test("hosted skill archives reject path traversal", async () => {
  const archive = await skillArchive([
    { name: "safe/SKILL.md", content: "---\nname: safe\ndescription: Safe.\n---\n" },
    { name: "safe/../secret", content: "nope" },
  ]);

  await assert.rejects(
    extractSkillBundleFromArchive(archive, "safe"),
    /PRISM_SKILL_ARCHIVE_UNSAFE/,
  );
});
