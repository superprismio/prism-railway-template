import assert from "node:assert/strict";
import test from "node:test";
import { discordEventService, DiscordEventError, parseEventCreate, parseEventUpdate } from "./discord-events.js";

const future = new Date(Date.now() + 86_400_000).toISOString();
const end = new Date(Date.now() + 90_000_000).toISOString();

test("validates external event fields and rejects malformed or past dates", () => {
  assert.deepEqual(parseEventCreate({ name: "Guild session", startTime: future, endTime: end, location: "Guild Hall" }), {
    name: "Guild session", privacy_level: 2, entity_type: 3,
    scheduled_start_time: future, scheduled_end_time: end, entity_metadata: { location: "Guild Hall" },
  });
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: future, location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: "2026-11-05T16:30:00", endTime: end, location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventCreate({ name: "Guild session", startTime: end, endTime: future, location: "Guild Hall" }), DiscordEventError);
  assert.throws(() => parseEventUpdate({ status: 4 }), DiscordEventError);
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
