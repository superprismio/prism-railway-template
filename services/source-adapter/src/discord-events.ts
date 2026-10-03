import { timingSafeEqual } from "node:crypto";

type RecordValue = Record<string, unknown>;

export class DiscordEventError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type DiscordEventRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const snowflake = /^\d{1,30}$/;
const eventStatuses = new Set([1, 2, 3, 4]);
const createLocks = new Map<string, Promise<void>>();

export function authorizeDiscordEventsToken(configured: string | undefined, supplied: string | undefined): void {
  if (!configured?.trim()) throw new DiscordEventError(503, "DISCORD_EVENTS_NOT_CONFIGURED", "Discord event access is not configured");
  const expected = Buffer.from(configured.trim());
  const actual = Buffer.from(supplied ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new DiscordEventError(401, "UNAUTHORIZED", "Unauthorized");
  }
}

export function discordEventUpstreamError(value: unknown): { status: number; code: string } {
  const message = value instanceof Error ? value.message : "";
  const upstreamStatus = /^Discord API failed: (\d+)/.exec(message)?.[1];
  switch (upstreamStatus) {
    case "400": return { status: 400, code: "DISCORD_EVENT_INVALID" };
    case "403": return { status: 403, code: "DISCORD_EVENTS_FORBIDDEN" };
    case "404": return { status: 404, code: "DISCORD_EVENT_NOT_FOUND" };
    case "429": return { status: 429, code: "DISCORD_RATE_LIMITED" };
    default: return { status: 502, code: "DISCORD_EVENTS_UPSTREAM_ERROR" };
  }
}

async function serialCreate<T>(key: string, action: () => Promise<T>): Promise<T> {
  const prior = createLocks.get(key);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  createLocks.set(key, gate);
  if (prior) await prior;
  try { return await action(); }
  finally {
    if (createLocks.get(key) === gate) createLocks.delete(key);
    release();
  }
}

function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "Expected an object");
  return value as RecordValue;
}

function string(value: unknown, field: string, max: number, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", `${field} must be a nonempty string of at most ${max} characters`);
  }
  return value.trim();
}

function timestamp(value: unknown, field: string): string {
  const raw = string(value, field, 60, true)!;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(raw);
  if (!match) {
    throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", `${field} must include a timezone`);
  }
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, zone] = match;
  const [year, month, day, hour, minute, second] = [yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw].map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", `${field} is invalid`);
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", `${field} is invalid`);
  return new Date(parsed).toISOString();
}

export function parseEventId(value: unknown): string {
  if (typeof value !== "string" || !snowflake.test(value)) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT_ID", "eventId must be a Discord snowflake");
  return value;
}

export function parseEventCreate(value: unknown): RecordValue {
  const input = object(value);
  const type = input.entityType ?? "external";
  if (type !== "external" && type !== "voice" && type !== "stage") throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "entityType must be external, voice, or stage");
  const name = string(input.name, "name", 100, true)!;
  const description = string(input.description, "description", 1000);
  const start = timestamp(input.startTime, "startTime");
  const end = input.endTime === undefined ? undefined : timestamp(input.endTime, "endTime");
  if (Date.parse(start) <= Date.now()) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "startTime must be in the future");
  if (end && Date.parse(end) <= Date.parse(start)) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "endTime must be after startTime");
  const location = string(input.location, "location", 100);
  const channelId = input.channelId === undefined ? undefined : parseEventId(input.channelId);
  if (type === "external" && (!end || !location || channelId)) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "External events require endTime and location and cannot set channelId");
  if (type !== "external" && (!channelId || location)) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "Voice and stage events require channelId and cannot set location");
  return {
    name, privacy_level: 2, entity_type: type === "external" ? 3 : type === "voice" ? 2 : 1,
    scheduled_start_time: start,
    ...(end ? { scheduled_end_time: end } : {}),
    ...(description ? { description } : {}),
    entity_metadata: location ? { location } : null,
    channel_id: channelId ?? null,
  };
}

export function parseEventUpdate(value: unknown): RecordValue {
  const input = object(value);
  const allowed = new Set(["name", "description", "startTime", "endTime", "location", "channelId"]);
  if (!Object.keys(input).length || Object.keys(input).some((key) => !allowed.has(key))) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "Update requires supported event fields");
  const result: RecordValue = {};
  if (input.name !== undefined) result.name = string(input.name, "name", 100, true);
  if (input.description !== undefined) result.description = string(input.description, "description", 1000);
  if (input.startTime !== undefined) result.scheduled_start_time = timestamp(input.startTime, "startTime");
  if (input.endTime !== undefined) result.scheduled_end_time = timestamp(input.endTime, "endTime");
  if (input.location !== undefined) result.entity_metadata = { location: string(input.location, "location", 100, true) };
  if (input.channelId !== undefined) result.channel_id = parseEventId(input.channelId);
  if (result.scheduled_start_time && result.scheduled_end_time && Date.parse(String(result.scheduled_end_time)) <= Date.parse(String(result.scheduled_start_time))) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "endTime must be after startTime");
  return result;
}

export function normalizeEvent(value: unknown): RecordValue {
  const event = object(value);
  return {
    id: event.id, guildId: event.guild_id, name: event.name, description: event.description ?? null,
    startTime: event.scheduled_start_time, endTime: event.scheduled_end_time ?? null,
    status: event.status, entityType: event.entity_type, channelId: event.channel_id ?? null,
    location: object(event.entity_metadata ?? {}).location ?? null,
    url: `https://discord.com/events/${event.guild_id}/${event.id}`,
  };
}

export function discordEventService(guildId: string, request: DiscordEventRequest) {
  if (!snowflake.test(guildId)) throw new DiscordEventError(503, "DISCORD_EVENTS_NOT_CONFIGURED", "Discord guild is not configured");
  const base = `/guilds/${guildId}/scheduled-events`;
  const validateChannel = async (channelId: unknown, entityType: unknown) => {
    if (channelId === null) return;
    const id = parseEventId(channelId);
    const channels = await request<RecordValue[]>(`/guilds/${guildId}/channels`);
    const channel = channels.find((entry) => entry.id === id);
    if (!channel || channel.type !== (entityType === 1 ? 13 : 2)) {
      throw new DiscordEventError(400, "INVALID_DISCORD_EVENT_CHANNEL", "channelId must refer to a matching voice or stage channel in this guild");
    }
  };
  const matchingEvent = (events: RecordValue[], body: RecordValue) => events.find((event) => event.name === body.name
    && Date.parse(String(event.scheduled_start_time)) === Date.parse(String(body.scheduled_start_time))
    && (event.scheduled_end_time ? Date.parse(String(event.scheduled_end_time)) : null) === (body.scheduled_end_time ? Date.parse(String(body.scheduled_end_time)) : null)
    && event.entity_type === body.entity_type
    && (event.channel_id ?? null) === (body.channel_id ?? null)
    && (object(event.entity_metadata ?? {}).location ?? null) === (object(body.entity_metadata ?? {}).location ?? null)
    && eventStatuses.has(Number(event.status)) && Number(event.status) !== 4);
  return {
    async list() {
      const events = await request<unknown[]>(base);
      return events.map(normalizeEvent);
    },
    async get(id: string) { return normalizeEvent(await request<unknown>(`${base}/${parseEventId(id)}`)); },
    async create(input: unknown) {
      const body = parseEventCreate(input);
      return serialCreate(`${guildId}:${JSON.stringify(body)}`, async () => {
        await validateChannel(body.channel_id, body.entity_type);
        const duplicate = matchingEvent(await request<RecordValue[]>(base), body);
        if (duplicate) return { created: false, event: normalizeEvent(duplicate) };
        try {
          const event = await request<unknown>(base, { method: "POST", body: JSON.stringify(body) });
          return { created: true, event: normalizeEvent(event) };
        } catch (error) {
          const status = /^Discord API failed: (\d+)/.exec(error instanceof Error ? error.message : "")?.[1];
          if (status && Number(status) < 500) throw error;
          const reconciled = await request<RecordValue[]>(base).then((events) => matchingEvent(events, body)).catch(() => undefined);
          if (reconciled) return { created: false, event: normalizeEvent(reconciled) };
          throw new DiscordEventError(502, "DISCORD_EVENT_CREATE_UNCERTAIN", "Event creation outcome is uncertain; inspect the event list before retrying");
        }
      });
    },
    async update(id: string, input: unknown) {
      const path = `${base}/${parseEventId(id)}`;
      const current = object(await request<unknown>(path));
      const changes = parseEventUpdate(input);
      const type = current.entity_type;
      const channelId = changes.channel_id ?? current.channel_id ?? null;
      if (type === 3 && (changes.channel_id !== undefined || changes.entity_metadata === undefined && !current.entity_metadata)) {
        throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "External events cannot set channelId and require a location");
      }
      if (type !== 3 && changes.entity_metadata !== undefined) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "Voice and stage events cannot set location");
      if (type !== 3) await validateChannel(channelId, type);
      const start = Date.parse(String(changes.scheduled_start_time ?? current.scheduled_start_time));
      const endValue = changes.scheduled_end_time ?? current.scheduled_end_time;
      if (endValue && Date.parse(String(endValue)) <= start) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "endTime must be after startTime");
      if (type === 3 && !endValue) throw new DiscordEventError(400, "INVALID_DISCORD_EVENT", "External events require endTime");
      const event = await request<unknown>(path, { method: "PATCH", body: JSON.stringify(changes) });
      return normalizeEvent(event);
    },
    async cancel(id: string) {
      const event = await request<unknown>(`${base}/${parseEventId(id)}`, { method: "PATCH", body: JSON.stringify({ status: 4 }) });
      return normalizeEvent(event);
    },
  };
}
