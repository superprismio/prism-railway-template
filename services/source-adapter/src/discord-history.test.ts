import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscordHistoryError,
  discordSearchParams,
  fetchDiscordHistoryContext,
  parseDiscordHistorySearchInput,
  searchDiscordHistory,
  timestampToDiscordSnowflake,
} from "./discord-history.js";

test("Discord history input validates and translates filters", () => {
  const input = parseDiscordHistorySearchInput({
    query: "approval gate",
    channelIds: ["123", "123", "456"],
    authorIds: ["789"],
    from: "2020-01-01T00:00:00Z",
    to: "2021-01-01T00:00:00Z",
    has: ["link"],
    sortBy: "timestamp",
    limit: 10,
  });
  const params = discordSearchParams(input);
  assert.equal(params.get("content"), "approval gate");
  assert.deepEqual(params.getAll("channel_id"), ["123", "456"]);
  assert.deepEqual(params.getAll("author_id"), ["789"]);
  assert.equal(params.get("limit"), "10");
  assert.equal(params.get("sort_by"), "timestamp");
  assert.equal(params.get("min_id"), timestampToDiscordSnowflake("2020-01-01T00:00:00.000Z"));
  assert.ok(params.get("max_id"));
});

test("Discord history rejects invalid filters", () => {
  assert.throws(() => parseDiscordHistorySearchInput({ query: "x", limit: 26 }), DiscordHistoryError);
  assert.throws(() => parseDiscordHistorySearchInput({ query: "x", channelIds: ["not-an-id"] }), DiscordHistoryError);
  assert.throws(() => parseDiscordHistorySearchInput({ query: "x", has: ["unknown"] }), DiscordHistoryError);
});

test("Discord native search normalizes nested results and creates a cursor", async () => {
  let requestedUrl = "";
  const fetchImpl: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({
      total_results: 2,
      messages: [[{
        id: "999",
        channel_id: "123",
        content: "Use an approval gate",
        timestamp: "2020-01-02T00:00:00.000Z",
        author: { id: "789", username: "alice" },
        attachments: [],
        embeds: [],
      }]],
      threads: [{ id: "123", name: "ops" }],
    });
  };
  const result = await searchDiscordHistory({
    token: "secret",
    guildId: "555",
    search: parseDiscordHistorySearchInput({ query: "approval gate", limit: 1 }),
    fetchImpl,
  });
  assert.match(requestedUrl, /\/guilds\/555\/messages\/search/);
  assert.equal(result.results[0]?.channelName, "ops");
  assert.equal(result.results[0]?.threadId, "123");
  assert.equal(result.results[0]?.url, "https://discord.com/channels/555/123/999");
  assert.ok(result.nextCursor);
});

test("Discord indexing response is retryable", async () => {
  const fetchImpl: typeof fetch = async () => Response.json(
    { code: 110000, retry_after: 3, documents_indexed: 42 },
    { status: 202 },
  );
  await assert.rejects(
    searchDiscordHistory({ token: "secret", guildId: "555", search: parseDiscordHistorySearchInput({ query: "old" }), fetchImpl }),
    (error: unknown) => error instanceof DiscordHistoryError
      && error.code === "DISCORD_SEARCH_INDEXING"
      && error.details.retryAfterSeconds === 3,
  );
});

test("Discord rate limits preserve the provider retry delay", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ retry_after: 1.5 }, { status: 429 });
  await assert.rejects(
    searchDiscordHistory({ token: "secret", guildId: "555", search: parseDiscordHistorySearchInput({ query: "old" }), fetchImpl }),
    (error: unknown) => error instanceof DiscordHistoryError
      && error.code === "DISCORD_RATE_LIMITED"
      && error.details.retryAfterSeconds === 1.5,
  );
});

test("Discord context is returned chronologically with the selected message", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages/20")) {
      return Response.json({ id: "20", channel_id: "10", content: "selected", timestamp: "2020-01-02T00:00:00Z", author: {} });
    }
    if (url.searchParams.has("before")) {
      return Response.json([{ id: "19", channel_id: "10", content: "before", timestamp: "2020-01-01T00:00:00Z", author: {} }]);
    }
    return Response.json([{ id: "21", channel_id: "10", content: "after", timestamp: "2020-01-03T00:00:00Z", author: {} }]);
  };
  const result = await fetchDiscordHistoryContext({
    token: "secret",
    guildId: "555",
    context: { channelId: "10", messageId: "20", before: 1, after: 1 },
    fetchImpl,
  });
  assert.deepEqual(result.messages.map((message) => message.messageId), ["19", "20", "21"]);
});


test("date-only history requires a bounded window and omits the content filter", () => {
  const bounds = { from: "2026-06-21T00:00:00Z", to: "2026-06-22T00:00:00Z" };
  for (const query of [undefined, "", "   "]) {
    const params = discordSearchParams(parseDiscordHistorySearchInput({ ...bounds, query, channelIds: ["123"], sortBy: "timestamp" }));
    assert.equal(params.has("content"), false);
    assert.ok(params.get("min_id"));
    assert.ok(params.get("max_id"));
    assert.deepEqual(params.getAll("channel_id"), ["123"]);
    assert.equal(params.get("include_nsfw"), "false");
  }
  for (const input of [{}, { from: bounds.from }, { to: bounds.to },
    { ...bounds, to: "2026-06-22T00:00:00.001Z" },
    { ...bounds, to: bounds.from }, { ...bounds, from: "invalid" }]) {
    assert.throws(() => parseDiscordHistorySearchInput(input), DiscordHistoryError);
  }
});

test("date-only pagination preserves bounds and rejects a cursor from another window", async () => {
  const bounds = { from: "2026-06-21T00:00:00Z", to: "2026-06-22T00:00:00Z", limit: 1, sortBy: "timestamp" };
  const result = await searchDiscordHistory({ token: "test", guildId: "555",
    search: parseDiscordHistorySearchInput(bounds),
    fetchImpl: async () => Response.json({ total_results: 2, messages: [[{ id: "999", channel_id: "123", content: "retained evidence" }]] }),
  });
  assert.ok(result.nextCursor);
  const params = discordSearchParams(parseDiscordHistorySearchInput({ ...bounds, cursor: result.nextCursor }));
  assert.equal(params.get("offset"), "1");
  assert.equal(params.has("content"), false);
  assert.throws(() => discordSearchParams(parseDiscordHistorySearchInput({ ...bounds,
    from: "2026-06-21T01:00:00Z", cursor: result.nextCursor })), DiscordHistoryError);
});
