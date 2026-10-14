# Codex Runtime model tier migration

Prism agent profiles select the provider-neutral `economy`, `standard`, and
`deep` tiers. Codex Runtime resolves each tier from its Railway environment;
the profiles do not need model IDs or a migration. The runtime image pins Codex
CLI `0.162.1` in its package manifest and lockfiles.

For the RaidGuild `prism-stack` instance, the proposed GPT-6 mapping is:

| Railway variable | Value |
| --- | --- |
| `CODEX_MODEL` | `gpt-6.1-sol` |
| `CODEX_MODEL_ECONOMY` | `gpt-6-luna` |
| `CODEX_REASONING_EFFORT_ECONOMY` | `low` |
| `CODEX_MODEL_STANDARD` | `gpt-6.1-sol` |
| `CODEX_REASONING_EFFORT_STANDARD` | `medium` |
| `CODEX_MODEL_DEEP` | `gpt-6-astra` |
| `CODEX_REASONING_EFFORT_DEEP` | `high` |

`CODEX_MODEL` also covers invocations without an explicit tier. Keep the
explicit standard mapping so that its behavior does not depend on the CLI
default. Other Prism instances should verify their own account access and
model availability before adopting these values.

On October 14, 2026, each proposed model and effort pair returned the exact
response `CANARY_OK` through `codex exec` on the live `prism-stack`
`codex-runtime` service, using CLI `0.162.1`, a read-only sandbox, a temporary
workspace, and a prompt that forbade tool calls. Run these commands from a
checkout linked to the intended Railway project and environment; they fail if
the CLI version, any model response, or any process exit differs:

```bash
railway ssh --service codex-runtime -- node -e '
  const { execFileSync } = require("node:child_process");
  const version = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
  if (version !== "codex-cli 0.162.1") throw new Error(`Unexpected CLI: ${version}`);
  console.log(version);
'
for pair in 'gpt-6-luna low' 'gpt-6.1-sol medium' 'gpt-6-astra high'; do
  read -r model effort <<< "$pair"
  railway ssh --service codex-runtime -- node -e '
    const { spawnSync } = require("node:child_process");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const [model, effort] = process.argv.slice(1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prism-model-canary-"));
    try {
      const output = path.join(dir, "answer.txt");
      const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only",
        "--model", model, "-c", `model_reasoning_effort=${effort}`,
        "-o", output, "-C", dir, "Respond with exactly CANARY_OK. Do not call tools."];
      const result = spawnSync("codex", args, { encoding: "utf8", timeout: 120000 });
      const answer = fs.existsSync(output) ? fs.readFileSync(output, "utf8").trim() : "";
      if (result.error || result.status !== 0 || answer !== "CANARY_OK") {
        throw new Error(`${model}/${effort} failed: exit=${result.status}, answer=${answer}, error=${result.error?.message || "none"}`);
      }
      console.log(`${model}/${effort}: CANARY_OK`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  ' "$model" "$effort"
done
```

The CLI canaries establish model access and basic CLI compatibility. They do
not exercise Prism's tier mapping. Before redeploying, pause new request and
agent dispatch in a maintenance window and drain active Site runs. The runtime
job API has no list endpoint, so use Site's durable run records for this check:

```bash
railway ssh --service site -- node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/data/prism-agent.db", { readonly: true });
  const rows = db.prepare(`
    SELECT id, status, created_at
    FROM agent_runs
    WHERE status IN (?, ?, ?, ?, ?)
    ORDER BY created_at
  `).all("queued", "claimed", "running", "canceling", "completing");
  console.log(JSON.stringify(rows));
  if (rows.length) process.exitCode = 1;
'
```

Wait for an empty list. Recheck immediately before redeploying; if new runs
appear, defer the redeploy. Direct adapter callers may also have jobs outside
Site's records, so hold their ingress during the maintenance window. A runtime
redeploy can discard in-memory job IDs and leave Site with
`RUNTIME_JOB_NOT_FOUND` if a job is still running.

Set all seven variables in one Railway update without triggering an immediate
deployment, then explicitly redeploy only `codex-runtime`:

```bash
railway variable set --service codex-runtime --skip-deploys \
  CODEX_MODEL=gpt-6.1-sol \
  CODEX_MODEL_ECONOMY=gpt-6-luna \
  CODEX_REASONING_EFFORT_ECONOMY=low \
  CODEX_MODEL_STANDARD=gpt-6.1-sol \
  CODEX_REASONING_EFFORT_STANDARD=medium \
  CODEX_MODEL_DEEP=gpt-6-astra \
  CODEX_REASONING_EFFORT_DEEP=high
railway redeploy --service codex-runtime --yes
```

Once Railway reports the service healthy, test the runtime job contract itself.
The following submits a separate read-only utility job for each tier, polls
until terminal, and asserts the returned model, tier, effort, and
`model.selected` trace. Run it with new IDs after each deployment:

```bash
for tier in economy standard deep; do
  railway ssh --service codex-runtime -- node -e '
    const { randomUUID } = require("node:crypto");
    const tier = process.argv[1];
    const expected = {
      economy: ["gpt-6-luna", "low"],
      standard: ["gpt-6.1-sol", "medium"],
      deep: ["gpt-6-astra", "high"],
    }[tier];
    if (!expected) throw new Error(`Unknown tier: ${tier}`);
    const base = `http://127.0.0.1:${process.env.PORT || 3030}`;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = randomUUID();
    const request = {
      contractVersion: "2026-07-10",
      authorityMode: "read_only_utility",
      modelTier: tier,
      sessionId: `model-canary-${id}`,
      prompt: "Respond with exactly CANARY_OK. Do not call tools.",
    };
    (async () => {
      const submitted = await fetch(`${base}/v1/runtime/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `model-canary-${id}` },
        body: JSON.stringify(request),
      });
      const created = await submitted.json();
      if (submitted.status !== 202 || !created.jobId) throw new Error(JSON.stringify(created));
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const response = await fetch(`${base}/v1/runtime/jobs/${created.jobId}`);
        const payload = await response.json();
        if (!response.ok || !payload.job) throw new Error(JSON.stringify(payload));
        const job = payload.job;
        if (job.status === "succeeded") {
          const meta = job.result?.providerMetadata;
          const selected = job.trace?.find(event => event.kind === "model.selected");
          const traced = selected ? JSON.parse(selected.message) : null;
          if (job.result?.responseText?.trim() !== "CANARY_OK"
              || meta?.model !== expected[0] || meta?.modelTier !== tier
              || meta?.reasoningEffort !== expected[1]
              || traced?.model !== expected[0] || traced?.modelTier !== tier
              || traced?.reasoningEffort !== expected[1]) {
            throw new Error(`Wrong model selection for ${tier}: ${JSON.stringify({ meta, traced })}`);
          }
          console.log(`${tier}: ${meta.model}/${meta.reasoningEffort} CANARY_OK`);
          return;
        }
        if (["failed", "canceled"].includes(job.status)) throw new Error(JSON.stringify(job.error));
        await sleep(2000);
      }
      throw new Error(`Timed out waiting for ${tier} job ${created.jobId}`);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  ' "$tier"
done
```

Keep the previous variable values available for rollback. If a tier fails,
restore them with one `railway variable set --service codex-runtime
--skip-deploys` command and redeploy the same service before retrying
request-backed work.

The image generation smoke test remains a separate gate for future Codex CLI
upgrades; see [Codex Runtime image generation version pin](codex-runtime-image-generation-pin.md).
