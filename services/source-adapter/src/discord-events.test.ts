import assert from "node:assert/strict";
import test from "node:test";
import { authorizeDiscordEventsToken, discordEventService, discordEventUpstreamError, DiscordEventError, parseEventCreate, parseEventUpdate } from "./discord-events.js";

const future = new Date(Date.now() + 86_400_000).toISOString();
const end = new Date(Date.now() + 90_000_000).toISOString();

test("validates external event fields and rejects malformed or past dates", () => {
  assert.deepEqual(parseEventCreate({ name: "Guild session", startTime: future, endTime: end, location: "Guild Hall" }), {
    name: "Guild session", privacy_level: 2, entity_type: 3,
    scheduled_start_time: future, scheduled_end_time: end, entity_metadata: { location: "Guild Hall" }, channel_id: null,
  });
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: future, location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: "2026-11-05T16:30:00", endTime: end, location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: "2027-02-30T16:30:00Z", endTime: "2027-03-01T17:15:00Z", location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: "2027-10-01T25:30:00Z", endTime: "2027-10-02T17:15:00Z", location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: end, endTime: future, location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventUpdate({ status: 4 }), DiscordEventError);
});

test("event token fails closed without configuration and rejects wrong tokens", () => {
  assert.throws(() => authorizeDiscordEventsToken(undefined, undefined), (error: unknown) => error instanceof DiscordEventError && error.status === 503);
  assert.throws(() => authorizeDiscordEventsToken("secret", "wrong"), (error: unknown) => error instanceof DiscordEventError && error.status === 401);
  assert.doesNotThrow(() => authorizeDiscordEventsToken("secret", "secret"));
});

test("maps Discord validation and permission failures without leaking upstream body", () => {
  assert.deepEqual(discordEventUpstreamError(new Error("Discord API failed: 400 /guilds/123/scheduled-events sensitive")), { status: 400, code: "DISCORD_EVENT_INVALID" });
  assert.deepEqual(discordEventUpstreamError(new Error("Discord API failed: 403 /guilds/123/scheduled-events")), { status: 403, code: "DISCORD_EVENTS_FORBIDDEN" });
  assert.deepEqual(discordEventUpstreamError(new Error("Discord API failed: 404 /guilds/123/scheduled-events")), { status: 404, code: "DISCORD_EVENT_NOT_FOUND" });
  assert.deepEqual(discordEventUpstreamError(new Error("Discord API failed: 429 /guilds/123/scheduled-events")), { status: 429, code: "DISCORD_RATE_LIMITED" });
});

test("deduplicates matching events and creates a new event only once", async () => {
  const guildId = "123456";
  const stored: Record<string, unknown>[] = [];
  let posts = 0;
  const request = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    if (init?.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body));
      const event = { ...body, id: "456789", guild_id: guildId, status: 1, channel_id: null };
      stored.push(event);
      return event as T;
    }
    return stored as T;
  };
  const service = discordEventService(guildId, request);
  const input = { name: "Guild session", startTime: future, endTime: end, location: "Guild Hall" };
  assert.equal((await service.create(input)).created, true);
  const second = await service.create(input);
  assert.equal(second.created, false);
  assert.equal(second.event.url, "https://discord.com/events/123456/456789");
  assert.equal(posts, 1);
});

test("serializes concurrent identical creates", async () => {
  const stored: Record<string, unknown>[] = [];
  let posts = 0;
  const request = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    if (init?.method === "POST") {
      posts++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const event = { ...JSON.parse(String(init.body)), id: "999", guild_id: "123456", status: 1 };
      stored.push(event);
      return event as T;
    }
    return stored as T;
  };
  const service = discordEventService("123456", request);
  const input = { name: "Concurrent event", startTime: future, endTime: end, location: "Guild Hall" };
  const outcomes = await Promise.all([service.create(input), service.create(input)]);
  assert.deepEqual(outcomes.map((result) => result.created).sort(), [false, true]);
  assert.equal(posts, 1);
});

test("validates voice channel membership and type before create or update", async () => {
  let writes = 0;
  const current = { id: "2", guild_id: "123456", name: "Voice meeting", entity_type: 2, channel_id: "12", scheduled_start_time: future, scheduled_end_time: end, status: 1 };
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    if (init?.method) { writes++; return current as T; }
    if (path.endsWith("/channels")) return [{ id: "12", type: 2 }, { id: "13", type: 13 }] as T;
    if (path.endsWith("/2")) return current as T;
    return [] as T;
  };
  const service = discordEventService("123456", request);
  await assert.rejects(service.create({ name: "Voice meeting", entityType: "voice", channelId: "13", startTime: future }), DiscordEventError);
  await assert.rejects(service.update("2", { channelId: "99" }), DiscordEventError);
  await assert.rejects(service.update("2", { startTime: new Date(Date.parse(end) + 1000).toISOString() }), DiscordEventError);
  assert.equal(writes, 0);
});

test("reconciles uncertain POST and reports unresolved outcome without retrying", async () => {
  let posts = 0;
  let reconciled = false;
  const request = async <T>(_path: string, init?: RequestInit): Promise<T> => {
    if (init?.method === "POST") { posts++; throw new Error("network lost"); }
    return (reconciled ? [{ id: "9", guild_id: "123456", name: "Network event", scheduled_start_time: future, scheduled_end_time: end, entity_type: 3, channel_id: null, entity_metadata: { location: "Hall" }, status: 1 }] : []) as T;
  };
  const service = discordEventService("123456", request);
  const input = { name: "Network event", startTime: future, endTime: end, location: "Hall" };
  await assert.rejects(service.create(input), (error: unknown) => error instanceof DiscordEventError && error.code === "DISCORD_EVENT_CREATE_UNCERTAIN");
  reconciled = true;
  assert.equal((await service.create(input)).created, false);
  assert.equal(posts, 1);
});
