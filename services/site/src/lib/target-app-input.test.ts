import assert from "node:assert/strict"
import test from "node:test"

import { normalizeGitHubRepoUrl, parseAgentTargetAppInput } from "./target-app-input"

test("target app input derives safe defaults from a GitHub repository URL", () => {
  const result = parseAgentTargetAppInput({
    repoUrl: "https://github.com/raid-guild/bard-calendar.git/",
  })

  assert.deepEqual(result, {
    ok: true,
    input: {
      slug: "bard-calendar",
      name: "bard-calendar",
      description: null,
      repoUrl: "https://github.com/raid-guild/bard-calendar",
      defaultBranch: "main",
    },
  })
})

test("target app input accepts explicit metadata and snake-case aliases", () => {
  const result = parseAgentTargetAppInput({
    repo_url: "https://github.com/raid-guild/bard-calendar",
    name: "Bard Calendar",
    slug: "raidguild-calendar",
    description: "Community calendar",
    default_branch: "develop",
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.input.slug, "raidguild-calendar")
    assert.equal(result.input.defaultBranch, "develop")
  }
})

test("target app input rejects non-GitHub URLs and invalid slugs", () => {
  assert.equal(parseAgentTargetAppInput({ repoUrl: "https://example.com/repo" }).ok, false)
  assert.equal(parseAgentTargetAppInput({
    repoUrl: "https://github.com/raid-guild/bard-calendar",
    slug: "Bard Calendar",
  }).ok, false)
  assert.equal(normalizeGitHubRepoUrl("https://github.com/raid-guild/bard-calendar/issues"), null)
})

test("GitHub repository normalization removes only transport noise", () => {
  assert.equal(
    normalizeGitHubRepoUrl("https://github.com/Raid-Guild/Bard-Calendar.git/"),
    "https://github.com/Raid-Guild/Bard-Calendar",
  )
})
