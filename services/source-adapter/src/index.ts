import express, { type Request, type Response } from "express";
import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Interaction,
  Message,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
  type AnyThreadChannel,
  type TextBasedChannel,
} from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { DiscordVoiceManager } from "./voice.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12]);
const DISCORD_PARENT_CHANNEL_TYPES = new Set([0, 5, 15, 16]);
const BRIDGE_THREAD_PREFIX = "prism ";
const TEXT_ATTACHMENT_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".log", ".json", ".yml", ".yaml"]);
const DISCORD_ATTACHMENT_HOST_SUFFIXES = ["discordapp.com", "discordapp.net", "discord.com", "discordcdn.com"];
const CHANGE_REQUEST_ASYNC_PATTERN =
  /\b(start|continue|run|resume|deploy)\b.*\b(change request|cr\s*#?\d+|latest change request|request\s*#?\d+)\b/i;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type AdapterConfig = ReturnType<typeof adapterConfig>;

type DiscordAuthor = {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
  bot: boolean;
};

type AttachmentText = {
  filename: string;
  url: string;
  status: string;
  size?: number | null;
  truncated?: boolean;
  text?: string;
  error?: string;
};

type AdapterDestination = {
  adapter: string;
  id: string;
  type: string;
  name: string | null;
  label: string;
  parentId?: string | null;
};

let bridgeClient: Client | null = null;
let voiceManager: DiscordVoiceManager | null = null;
let discordReady = false;
let discordUserTag: string | null = null;
const discordPromptQueues = new Map<string, Promise<void>>();

function nowUtcIso(): string {
  return new Date().toISOString();
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.trim()) {
      return `${error.message.trim()}: ${cause.message.trim()}`;
    }
    if (cause) {
      return `${error.message.trim()}: ${String(cause)}`;
    }
    return error.message.trim();
  }
  return String(error);
}

function parseIntEnv(name: string, defaultValue: number, minimum?: number, maximum?: number): number {
  const raw = (process.env[name] ?? "").trim();
  let value = raw ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer`);
  }
  if (typeof minimum === "number") {
    value = Math.max(minimum, value);
  }
  if (typeof maximum === "number") {
    value = Math.min(maximum, value);
  }
  return value;
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  return new Set(["1", "true", "yes", "on"]).has(raw);
}

function dataRoot(): string {
  const configured = (process.env.SOURCE_ADAPTER_DATA_ROOT ?? "").trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "data");
}

function checkpointPath(): string {
  return path.join(dataRoot(), "checkpoints.json");
}

function sourceAdapterPublicBaseUrl(): string | null {
  const explicit = (process.env.SOURCE_ADAPTER_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (explicit) {
    return explicit;
  }
  const railwayPublic = (process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.RAILWAY_STATIC_URL ?? "").trim();
  if (railwayPublic) {
    return `https://${railwayPublic.replace(/\/+$/, "")}`;
  }
  const port = Number(process.env.PORT ?? "8789");
  if (Number.isFinite(port) && port > 0) {
    return `http://127.0.0.1:${port}`;
  }
  return null;
}

async function loadCheckpoints(): Promise<Record<string, JsonValue>> {
  try {
    const content = await fs.readFile(checkpointPath(), "utf8");
    return JSON.parse(content) as Record<string, JsonValue>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveCheckpoints(payload: Record<string, JsonValue>): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  await fs.writeFile(checkpointPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function checkpointOverlapMinutes(): number {
  return parseIntEnv("SOURCE_CHECKPOINT_OVERLAP_MINUTES", 5, 0, 24 * 60);
}

function adapterConfig() {
  return {
    sourceKind: (process.env.SOURCE_KIND ?? "discord").trim() || "discord",
    space: (process.env.SOURCE_SPACE ?? "community").trim() || "community",
    syncMode: (process.env.SOURCE_SYNC_MODE ?? "manual").trim() || "manual",
    prismApiBase: (process.env.PRISM_API_BASE ?? "").trim().replace(/\/+$/, ""),
    prismIngestPath: (process.env.PRISM_INGEST_PATH ?? "/ingest/messages").trim() || "/ingest/messages",
    discordGuildId: (process.env.DISCORD_GUILD_ID ?? "").trim(),
    discordWindowHours: parseIntEnv("DISCORD_SYNC_WINDOW_HOURS", 24, 1, 24 * 30),
    discordMaxMessagesPerChannel: parseIntEnv("DISCORD_MAX_MESSAGES_PER_CHANNEL", 200, 1, 1000),
    discordIncludeArchivedThreads: parseBoolEnv("DISCORD_INCLUDE_ARCHIVED_THREADS", false),
    discordIgnoreBotMessages: parseBoolEnv("DISCORD_IGNORE_BOT_MESSAGES", false),
    discordAttachmentTextEnabled: parseBoolEnv("DISCORD_ATTACHMENT_TEXT_ENABLED", true),
    discordEmbedTextEnabled: parseBoolEnv("DISCORD_EMBED_TEXT_ENABLED", true),
    discordAttachmentTextMaxBytes: parseIntEnv("DISCORD_ATTACHMENT_TEXT_MAX_BYTES", 200_000, 1, 2_000_000),
    discordAttachmentTextMaxChars: parseIntEnv("DISCORD_ATTACHMENT_TEXT_MAX_CHARS", 12_000, 500, 100_000),
    discordAttachmentTextMaxFilesPerMessage: parseIntEnv("DISCORD_ATTACHMENT_TEXT_MAX_FILES_PER_MESSAGE", 3, 0, 10),
    discordChatEnabled: parseBoolEnv("DISCORD_CHAT_ENABLED", true),
    discordRegisterCommands: parseBoolEnv("DISCORD_REGISTER_COMMANDS", true),
    discordCommandGuildId: ((process.env.DISCORD_COMMAND_GUILD_ID ?? "").trim() || (process.env.DISCORD_GUILD_ID ?? "").trim()),
    discordApplicationId: (process.env.DISCORD_APPLICATION_ID ?? "").trim(),
    codexRuntimeRequestTimeoutSeconds: parseIntEnv("CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS", 660, 30, 3600),
    checkpointOverlapMinutes: checkpointOverlapMinutes(),
  };
}

function checkpointKey(config: AdapterConfig): string {
  const guildId = config.discordGuildId || "default";
  return `${config.sourceKind}:${config.space}:${guildId}`;
}

async function currentCheckpoint(config: AdapterConfig): Promise<JsonObject | null> {
  const checkpoints = await loadCheckpoints();
  const value = checkpoints[checkpointKey(config)];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as JsonObject;
}

function parseIsoDate(value: string): Date {
  const normalized = value.endsWith("Z") ? value : `${value.replace(/\+00:00$/, "")}Z`;
  return new Date(normalized);
}

function buildMessageAuthor(message: JsonObject): DiscordAuthor {
  const author = (message.author && typeof message.author === "object" ? message.author : {}) as JsonObject;
  const member = (message.member && typeof message.member === "object" ? message.member : {}) as JsonObject;
  return {
    id: typeof author.id === "string" ? author.id : null,
    username: typeof author.username === "string" ? author.username : null,
    displayName:
      (typeof member.nick === "string" && member.nick) ||
      (typeof author.global_name === "string" && author.global_name) ||
      (typeof author.username === "string" ? author.username : null),
    bot: Boolean(author.bot),
  };
}

function cleanMultilineText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function attachmentIsTextLike(attachment: JsonObject): boolean {
  const filename = String(attachment.filename ?? "").toLowerCase();
  const contentType = String(attachment.content_type ?? "").toLowerCase();
  const suffix = path.extname(filename).toLowerCase();
  if (TEXT_ATTACHMENT_EXTENSIONS.has(suffix)) {
    return true;
  }
  return (
    contentType.startsWith("text/") ||
    new Set(["application/json", "application/x-yaml", "application/yaml"]).has(contentType)
  );
}

function attachmentUrlAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return DISCORD_ATTACHMENT_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function readAttachmentText(attachment: JsonObject, config: AdapterConfig): Promise<AttachmentText | null> {
  if (!config.discordAttachmentTextEnabled || !attachmentIsTextLike(attachment)) {
    return null;
  }
  const url = String(attachment.url ?? "").trim();
  const filename = String(attachment.filename ?? "").trim();
  if (!url || !filename || !attachmentUrlAllowed(url)) {
    return null;
  }

  const size = typeof attachment.size === "number" ? attachment.size : Number(attachment.size ?? NaN);
  const sizeValue = Number.isFinite(size) ? size : null;
  if (sizeValue !== null && sizeValue > config.discordAttachmentTextMaxBytes) {
    return { filename, url, status: "skipped_too_large", size: sizeValue };
  }

  const headers = new Headers({ "User-Agent": "prism-source-adapter/1.0" });
  if (new URL(url).hostname.includes("discord") && process.env.DISCORD_BOT_TOKEN) {
    headers.set("Authorization", `Bot ${process.env.DISCORD_BOT_TOKEN}`);
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return { filename, url, status: "fetch_failed", error: `${response.status} ${response.statusText}` };
    }
    const body = new Uint8Array(await response.arrayBuffer());
    let truncated = body.byteLength > config.discordAttachmentTextMaxBytes;
    const limited = truncated ? body.slice(0, config.discordAttachmentTextMaxBytes) : body;
    const text = cleanMultilineText(Buffer.from(limited).toString("utf8"));
    if (!text) {
      return { filename, url, status: "empty" };
    }
    const limitedText = text.slice(0, config.discordAttachmentTextMaxChars).trim();
    if (limitedText.length < text.length) {
      truncated = true;
    }
    return { filename, url, status: "ok", size: sizeValue, truncated, text: limitedText };
  } catch (error) {
    return { filename, url, status: "fetch_failed", error: describeError(error) };
  }
}

function renderDiscordMessageText(baseText: string, embeds: JsonObject[], attachmentTexts: AttachmentText[], config: AdapterConfig): string {
  const sections: string[] = [];
  const cleanedBase = cleanMultilineText(baseText);
  if (cleanedBase) {
    sections.push(cleanedBase);
  }

  if (config.discordEmbedTextEnabled) {
    const embedLines = embeds
      .map((embed) => [embed.title, embed.description, embed.url].filter((part) => typeof part === "string" && part.trim()).join(" | "))
      .filter(Boolean)
      .map((line) => `- ${line}`);
    if (embedLines.length > 0) {
      sections.push(`Embeds:\n${embedLines.join("\n")}`);
    }
  }

  const extracted = attachmentTexts.filter((item) => item.status === "ok" && item.text?.trim());
  if (extracted.length > 0) {
    sections.push(
      extracted
        .map((item) => `Attachment: ${item.filename}${item.truncated ? " (truncated)" : ""}\n\`\`\`text\n${item.text}\n\`\`\``)
        .join("\n\n"),
    );
  }

  return sections.join("\n\n").trim();
}

function appApiBaseUrl(): string {
  const direct = (process.env.APP_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (direct) {
    return direct;
  }
  const railway = (process.env.RAILWAY_SERVICE_API_URL ?? "").trim();
  if (railway) {
    return `https://${railway.replace(/\/+$/, "")}`;
  }
  throw new Error("APP_API_BASE_URL is required");
}

function appApiServiceToken(): string {
  const token =
    (process.env.APP_API_SERVICE_TOKEN ?? "").trim() ||
    (process.env.INTERNAL_SERVICE_TOKEN ?? "").trim() ||
    (process.env.SERVICE_SHARED_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("APP_API_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN is required");
  }
  return token;
}

function codexRuntimeBaseUrl(): string {
  const direct = (process.env.CODEX_RUNTIME_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (direct) {
    return direct;
  }
  const railway = (process.env.RAILWAY_SERVICE_CODEX_RUNTIME_URL ?? "").trim();
  if (railway) {
    return `https://${railway.replace(/\/+$/, "")}`;
  }
  throw new Error("CODEX_RUNTIME_BASE_URL is required");
}

async function appApiRequest(pathname: string, init: RequestInit = {}): Promise<JsonObject> {
  const response = await fetch(`${appApiBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${appApiServiceToken()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`APP_API_REQUEST_FAILED:${response.status}:${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as JsonObject;
}

async function lookupDiscordSession(discordChannelId: string | null, discordThreadId: string | null, limit = 25): Promise<JsonObject | null> {
  const params = new URLSearchParams({
    channelId: discordChannelId ?? "",
    threadId: discordThreadId ?? "",
    limit: String(limit),
  });
  return appApiRequest(`/agent/agent-sessions/discord/lookup?${params.toString()}`);
}

async function upsertDiscordSession(input: {
  title: string;
  discordGuildId: string;
  discordChannelId: string;
  discordThreadId: string | null;
  meta: JsonObject;
  lastMessageAt: string;
}): Promise<JsonObject> {
  const payload = await appApiRequest("/agent/agent-sessions/discord/upsert", {
    method: "POST",
    body: JSON.stringify({
      source: "discord",
      status: "active",
      title: input.title,
      discordGuildId: input.discordGuildId,
      discordChannelId: input.discordChannelId,
      discordThreadId: input.discordThreadId,
      meta: input.meta,
      lastMessageAt: input.lastMessageAt,
    }),
  });
  return payload.session as JsonObject;
}

async function appendSessionMessage(input: {
  sessionId: string;
  role: string;
  source: string;
  sourceMessageId: string | null;
  content: string;
  meta: JsonObject;
  createdAt: string;
}): Promise<void> {
  await appApiRequest(`/agent/agent-sessions/${input.sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: input.role,
      source: input.source,
      sourceMessageId: input.sourceMessageId,
      content: input.content,
      meta: input.meta,
      createdAt: input.createdAt,
    }),
  });
}

async function codexRuntimeRequest(input: {
  prompt: string;
  sessionId: string;
  codexThreadId: string | null;
  recentHistory: Array<{ role: string; content: string }>;
  metadata: JsonObject;
}): Promise<{ responseText: string; codexThreadId: string | null }> {
  const timeoutMs = adapterConfig().codexRuntimeRequestTimeoutSeconds * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${codexRuntimeBaseUrl()}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        sessionId: input.sessionId,
        codexThreadId: input.codexThreadId,
        recentHistory: input.recentHistory,
        metadata: input.metadata,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`CODEX_RUNTIME_REQUEST_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
    }
    const payload = (await response.json()) as JsonObject;
    const responseText = typeof payload.responseText === "string" ? payload.responseText : typeof payload.output_text === "string" ? payload.output_text : "";
    if (!responseText.trim()) {
      throw new Error("CODEX_RUNTIME_EMPTY_RESPONSE");
    }
    return {
      responseText: responseText.trim(),
      codexThreadId: typeof payload.thread_id === "string" ? payload.thread_id : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function discordApiRequest<T extends JsonValue>(
  pathname: string,
  params?: Record<string, string | number | undefined>,
  init: RequestInit = {},
): Promise<T> {
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required for Discord adapter operations");
  }
  const url = new URL(`${DISCORD_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && `${value}` !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "prism-source-adapter/0.1",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Discord API failed: ${response.status} ${pathname} ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

async function listDiscordDestinations(): Promise<AdapterDestination[]> {
  const config = adapterConfig();
  if (!config.discordGuildId) {
    throw new Error("DISCORD_GUILD_ID is required to list Discord destinations");
  }
  const channelsPayload = await discordApiRequest<JsonValue[]>(`/guilds/${config.discordGuildId}/channels`);
  if (!Array.isArray(channelsPayload)) {
    throw new Error("Discord guild channels response was not a list");
  }
  return channelsPayload
    .filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item))
    .filter((channel) => DISCORD_TEXT_CHANNEL_TYPES.has(Number(channel.type)))
    .filter((channel) => typeof channel.id === "string")
    .map((channel) => {
      const name = typeof channel.name === "string" && channel.name.trim() ? channel.name.trim() : null;
      return {
        adapter: "discord",
        id: String(channel.id),
        type: "discord-channel",
        name,
        label: name ? `#${name}` : String(channel.id),
        parentId: typeof channel.parent_id === "string" ? channel.parent_id : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function sendDiscordMessage(destinationId: string, content: string): Promise<JsonObject> {
  const normalizedDestinationId = destinationId.trim();
  const normalizedContent = content.trim();
  if (!normalizedDestinationId) {
    throw new Error("destinationId is required");
  }
  if (!normalizedContent) {
    throw new Error("content is required");
  }
  const sent: JsonObject[] = [];
  for (const part of splitDiscordMessage(normalizedContent)) {
    const message = await discordApiRequest<JsonObject>(
      `/channels/${encodeURIComponent(normalizedDestinationId)}/messages`,
      undefined,
      {
        method: "POST",
        body: JSON.stringify({ content: part }),
      },
    );
    sent.push({
      id: typeof message.id === "string" ? message.id : null,
      channelId: typeof message.channel_id === "string" ? message.channel_id : normalizedDestinationId,
    });
  }
  return {
    adapter: "discord",
    destinationId: normalizedDestinationId,
    messageCount: sent.length,
    messages: sent,
  };
}

async function postBatchToPrism(payload: JsonObject): Promise<JsonObject> {
  const config = adapterConfig();
  if (!config.prismApiBase) {
    throw new Error("PRISM_API_BASE is required for sync");
  }
  const response = await fetch(`${config.prismApiBase}${config.prismIngestPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...((process.env.PRISM_API_KEY ?? "").trim() ? { "X-Prism-Api-Key": (process.env.PRISM_API_KEY ?? "").trim() } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Prism ingest failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return {
    status: response.status,
    url: `${config.prismApiBase}${config.prismIngestPath}`,
    body: (await response.json()) as JsonObject,
  };
}

async function normalizeDiscordMessage(input: {
  message: JsonObject;
  guildId: string;
  channel: JsonObject;
  threadParentId?: string | null;
}): Promise<JsonObject> {
  const config = adapterConfig();
  const attachments = Array.isArray(input.message.attachments) ? (input.message.attachments.filter((item): item is JsonObject => !!item && typeof item === "object") as JsonObject[]) : [];
  const embeds = Array.isArray(input.message.embeds) ? (input.message.embeds.filter((item): item is JsonObject => !!item && typeof item === "object") as JsonObject[]) : [];
  const attachmentTexts: AttachmentText[] = [];
  for (const attachment of attachments.slice(0, config.discordAttachmentTextMaxFilesPerMessage)) {
    const extracted = await readAttachmentText(attachment, config);
    if (extracted) {
      attachmentTexts.push(extracted);
    }
  }
  const channelId = typeof input.channel.id === "string" ? input.channel.id : null;
  const messageId = typeof input.message.id === "string" ? input.message.id : null;
  return {
    source: "discord",
    guildId: input.guildId,
    channelId,
    threadId: [10, 11, 12].includes(Number(input.channel.type)) ? channelId : null,
    messageId,
    text: String(input.message.content ?? ""),
    renderedText: renderDiscordMessageText(String(input.message.content ?? ""), embeds, attachmentTexts, config),
    timestamp: typeof input.message.timestamp === "string" ? input.message.timestamp : null,
    author: buildMessageAuthor(input.message),
    metadata: {
      channelName: typeof input.channel.name === "string" ? input.channel.name : null,
      channelType: input.channel.type ?? null,
      parentChannelId: input.threadParentId ?? (typeof input.channel.parent_id === "string" ? input.channel.parent_id : null),
      messageUrl: channelId && messageId ? `https://discord.com/channels/${input.guildId}/${channelId}/${messageId}` : null,
      attachmentCount: attachments.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id ?? null,
        filename: attachment.filename ?? null,
        contentType: attachment.content_type ?? null,
        size: attachment.size ?? null,
        url: attachment.url ?? null,
      })),
      embeds: embeds.map((embed) => ({
        title: embed.title ?? null,
        description: embed.description ?? null,
        url: embed.url ?? null,
        type: embed.type ?? null,
      })),
      attachmentTexts,
    },
  };
}

async function fetchChannelMessages(channelId: string, since: Date, until: Date, maxMessages: number): Promise<JsonObject[]> {
  const collected: JsonObject[] = [];
  let before: string | undefined;
  while (collected.length < maxMessages) {
    const batch = await discordApiRequest<JsonValue[]>(`/channels/${channelId}/messages`, {
      limit: Math.min(100, maxMessages - collected.length),
      before,
    });
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    let stop = false;
    for (const candidate of batch) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue;
      }
      const timestampRaw = typeof candidate.timestamp === "string" ? candidate.timestamp : null;
      if (!timestampRaw) {
        continue;
      }
      const timestamp = parseIsoDate(timestampRaw);
      if (timestamp > until) {
        continue;
      }
      if (timestamp < since) {
        stop = true;
        break;
      }
      collected.push(candidate as JsonObject);
      if (collected.length >= maxMessages) {
        break;
      }
    }
    const oldest = batch.at(-1);
    before = oldest && typeof oldest === "object" && !Array.isArray(oldest) && typeof oldest.id === "string" ? oldest.id : undefined;
    if (stop || !before) {
      break;
    }
  }
  return collected;
}

async function fetchArchivedThreads(parentChannelId: string, isPrivate: boolean): Promise<JsonObject[]> {
  const payload = await discordApiRequest<JsonObject>(
    isPrivate ? `/channels/${parentChannelId}/threads/archived/private` : `/channels/${parentChannelId}/threads/archived/public`,
    { limit: 100 },
  );
  return Array.isArray(payload.threads) ? (payload.threads.filter((item): item is JsonObject => !!item && typeof item === "object") as JsonObject[]) : [];
}

async function computeSyncWindow(config: AdapterConfig, resetCheckpoint: boolean): Promise<{ since: Date; until: Date; checkpoint: JsonObject | null }> {
  const until = new Date();
  if (resetCheckpoint) {
    return { since: new Date(until.getTime() - config.discordWindowHours * 60 * 60 * 1000), until, checkpoint: null };
  }
  const checkpoint = await currentCheckpoint(config);
  if (!checkpoint || typeof checkpoint.cursorTimestamp !== "string" || !checkpoint.cursorTimestamp.trim()) {
    return { since: new Date(until.getTime() - config.discordWindowHours * 60 * 60 * 1000), until, checkpoint };
  }
  let since = new Date(parseIsoDate(checkpoint.cursorTimestamp).getTime() - config.checkpointOverlapMinutes * 60 * 1000);
  if (since >= until) {
    since = new Date(until.getTime() - config.checkpointOverlapMinutes * 60 * 1000);
  }
  return { since, until, checkpoint };
}

async function updateCheckpoint(config: AdapterConfig, input: { since: Date; until: Date; messageCount: number; dryRun: boolean }): Promise<JsonObject> {
  const checkpointRecord: JsonObject = {
    sourceKind: config.sourceKind,
    space: config.space,
    guildId: config.discordGuildId || null,
    cursorTimestamp: input.until.toISOString(),
    lastWindowSince: input.since.toISOString(),
    lastWindowUntil: input.until.toISOString(),
    lastMessageCount: input.messageCount,
    updatedAt: nowUtcIso(),
  };
  if (input.dryRun) {
    checkpointRecord.dryRun = true;
    return checkpointRecord;
  }
  const checkpoints = await loadCheckpoints();
  checkpoints[checkpointKey(config)] = checkpointRecord;
  await saveCheckpoints(checkpoints);
  return checkpointRecord;
}

async function collectDiscordBatch(resetCheckpoint = false): Promise<{ payload: JsonObject; summary: JsonObject; since: Date; until: Date }> {
  const config = adapterConfig();
  if (!config.discordGuildId) {
    throw new Error("DISCORD_GUILD_ID is required for discord sync");
  }
  const { since, until, checkpoint } = await computeSyncWindow(config, resetCheckpoint);
  const channelsPayload = await discordApiRequest<JsonValue[]>(`/guilds/${config.discordGuildId}/channels`);
  if (!Array.isArray(channelsPayload)) {
    throw new Error("Discord guild channels response was not a list");
  }
  const channels = channelsPayload.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
  const textChannels = channels.filter((channel) => DISCORD_TEXT_CHANNEL_TYPES.has(Number(channel.type)));
  const parentChannels = channels.filter((channel) => DISCORD_PARENT_CHANNEL_TYPES.has(Number(channel.type)));
  const threadMap = new Map<string, JsonObject>();
  for (const channel of textChannels) {
    if ([10, 11, 12].includes(Number(channel.type)) && typeof channel.id === "string") {
      threadMap.set(channel.id, channel);
    }
  }
  if (config.discordIncludeArchivedThreads) {
    for (const parent of parentChannels) {
      if (typeof parent.id !== "string") {
        continue;
      }
      for (const isPrivate of [false, true]) {
        try {
          for (const thread of await fetchArchivedThreads(parent.id, isPrivate)) {
            if (typeof thread.id === "string") {
              threadMap.set(thread.id, thread);
            }
          }
        } catch (error) {
          if (!describeError(error).includes("403")) {
            throw error;
          }
        }
      }
    }
  }

  const targetChannels = [...textChannels, ...threadMap.values()].filter((channel, index, list) => {
    const id = typeof channel.id === "string" ? channel.id : null;
    return !!id && list.findIndex((entry) => entry.id === id) === index;
  });

  const normalizedMessages: JsonObject[] = [];
  const skippedChannels: JsonObject[] = [];
  for (const channel of targetChannels) {
    if (typeof channel.id !== "string") {
      continue;
    }
    try {
      const messages = await fetchChannelMessages(channel.id, since, until, config.discordMaxMessagesPerChannel);
      for (const message of messages) {
        const author = message.author && typeof message.author === "object" ? (message.author as JsonObject) : {};
        if (config.discordIgnoreBotMessages && Boolean(author.bot)) {
          continue;
        }
        normalizedMessages.push(await normalizeDiscordMessage({ message, guildId: config.discordGuildId, channel }));
      }
    } catch (error) {
      skippedChannels.push({
        channelId: channel.id,
        channelName: typeof channel.name === "string" ? channel.name : null,
        reason: describeError(error),
      });
    }
  }

  return {
    payload: {
      source: "discord",
      space: config.space,
      batchId: `discord-${config.discordGuildId}-${until.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
      messages: normalizedMessages,
    },
    summary: {
      guildId: config.discordGuildId,
      window: { since: since.toISOString(), until: until.toISOString() },
      checkpoint: { used: Boolean(checkpoint), value: checkpoint, path: checkpointPath() },
      channelCount: targetChannels.length,
      messageCount: normalizedMessages.length,
      skippedChannels,
    },
    since,
    until,
  };
}

function isAsyncChangeRequestCommand(prompt: string): boolean {
  return CHANGE_REQUEST_ASYNC_PATTERN.test(prompt.trim());
}

function buildAsyncChangeRequestAck(prompt: string): string {
  const normalized = prompt.trim().split(/\s+/).join(" ");
  return `Started: ${normalized}\n\nI’ll continue this change-request run in the background and post the result in this thread.`;
}

function isBridgeThread(channel: TextBasedChannel): channel is AnyThreadChannel {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() && channel.name.toLowerCase().startsWith(BRIDGE_THREAD_PREFIX);
}

function shouldHandleMessage(message: Message, clientUserId: string, guildId: string): boolean {
  if (!message.inGuild() || message.author.bot || message.guildId !== guildId) {
    return false;
  }
  return message.mentions.users.has(clientUserId);
}

function cleanPrompt(message: Message, botUserId: string): string {
  return message.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

async function ensureConversationThread(message: Message): Promise<TextBasedChannel | null> {
  if (message.channel.isThread()) {
    return message.channel;
  }
  if (!(message.channel instanceof TextChannel)) {
    return null;
  }
  if ("hasThread" in message && Boolean((message as Message & { hasThread?: boolean }).hasThread)) {
    const existingThread = (message as Message & { thread?: TextBasedChannel | null }).thread ?? null;
    if (existingThread) {
      if ("join" in existingThread && typeof existingThread.join === "function") {
        await existingThread.join().catch(() => {});
      }
      console.log("[discord-adapter] reusing existing message thread", {
        guildId: message.guildId,
        channelId: message.channel.id,
        messageId: message.id,
        threadId: "id" in existingThread ? existingThread.id : null,
      });
      return existingThread;
    }
  }
  try {
    const thread = await message.startThread({
      name: `Prism ${message.member?.displayName ?? message.author.displayName}`.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    });
    if ("join" in thread && typeof thread.join === "function") {
      await thread.join().catch(() => {});
    }
    console.log("[discord-adapter] created conversation thread", {
      guildId: message.guildId,
      channelId: message.channel.id,
      messageId: message.id,
      threadId: thread.id,
      threadName: thread.name,
    });
    return thread;
  } catch (error) {
    const existingThread = (message as Message & { thread?: TextBasedChannel | null }).thread ?? null;
    if (existingThread) {
      if ("join" in existingThread && typeof existingThread.join === "function") {
        await existingThread.join().catch(() => {});
      }
      console.warn("[discord-adapter] thread creation failed; using existing thread", {
        guildId: message.guildId,
        channelId: message.channel.id,
        messageId: message.id,
        threadId: "id" in existingThread ? existingThread.id : null,
        error: describeError(error),
      });
      return existingThread;
    }
    const botPermissions = message.guild?.members.me ? message.channel.permissionsFor(message.guild.members.me) : null;
    console.warn("[discord-adapter] thread creation failed", {
      guildId: message.guildId,
      channelId: message.channel.id,
      channelName: message.channel.name,
      canViewChannel: botPermissions?.has(PermissionFlagsBits.ViewChannel) ?? null,
      canSendMessages: botPermissions?.has(PermissionFlagsBits.SendMessages) ?? null,
      canCreatePublicThreads: botPermissions?.has(PermissionFlagsBits.CreatePublicThreads) ?? null,
      canSendMessagesInThreads: botPermissions?.has(PermissionFlagsBits.SendMessagesInThreads) ?? null,
      canReadMessageHistory: botPermissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? null,
      error: describeError(error),
    });
    return null;
  }
}

async function sendReply(channel: TextBasedChannel, content: string): Promise<Message | null> {
  if (!("send" in channel) || typeof channel.send !== "function") {
    return null;
  }
  return (await channel.send(content)) as Message;
}

const DISCORD_MESSAGE_MAX_LENGTH = 2000;

function splitDiscordMessage(content: string, maxLength = DISCORD_MESSAGE_MAX_LENGTH): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [""];
  }
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks.length ? chunks : [normalized.slice(0, maxLength)];
}

type DiscordPromptTransport = {
  guildId: string;
  channelId: string;
  threadId: string | null;
  channelName: string | null;
  threadName: string | null;
  authorId: string;
  authorName: string;
  userSourceMessageId: string | null;
  createdAt: string;
  sendTyping?: () => Promise<void>;
  sendAssistantMessage: (content: string) => Promise<{ sourceMessageId: string | null }>;
};

function startTypingHeartbeat(sendTyping: (() => Promise<void>) | undefined): () => void {
  if (!sendTyping) {
    return () => undefined;
  }
  let stopped = false;
  const tick = () => {
    void sendTyping().catch((error) => {
      console.warn("[discord-adapter] sendTyping failed", describeError(error));
    });
  };
  tick();
  const timer = setInterval(() => {
    if (!stopped) {
      tick();
    }
  }, 8_000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function runDiscordPrompt(prompt: string, transport: DiscordPromptTransport): Promise<void> {
  let existing: JsonObject | null = null;
  try {
    existing = await lookupDiscordSession(transport.channelId, transport.threadId);
  } catch (error) {
    console.warn("[discord-adapter] session lookup failed", describeError(error));
  }

  const session = await upsertDiscordSession({
    title: `Discord chat: ${prompt.slice(0, 80)}`,
    discordGuildId: transport.guildId,
    discordChannelId: transport.channelId,
    discordThreadId: transport.threadId,
    meta: {
      transport: "discord",
      channelName: transport.channelName,
      threadName: transport.threadName,
    },
    lastMessageAt: transport.createdAt,
  });

  await appendSessionMessage({
    sessionId: String(session.id),
    role: "user",
    source: "discord",
    sourceMessageId: transport.userSourceMessageId,
    content: prompt,
    meta: {
      authorId: transport.authorId,
      authorName: transport.authorName,
    },
    createdAt: transport.createdAt,
  });

  const existingMessages = Array.isArray(existing?.messages) ? existing.messages : [];
  const recentHistory = existingMessages
    .slice(-12)
    .filter((entry): entry is JsonObject => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      role: typeof entry.role === "string" ? entry.role : "user",
      content: typeof entry.content === "string" ? entry.content : "",
    }))
    .filter((entry) => entry.content);

  const existingSession = existing?.session && typeof existing.session === "object" ? (existing.session as JsonObject) : {};
  const sessionMeta = session.meta && typeof session.meta === "object" ? (session.meta as JsonObject) : {};
  let codexThreadId =
    (typeof existingSession.meta === "object" && existingSession.meta && typeof (existingSession.meta as JsonObject).codexThreadId === "string"
      ? String((existingSession.meta as JsonObject).codexThreadId)
      : null) ||
    (typeof sessionMeta.codexThreadId === "string" ? sessionMeta.codexThreadId : null);

  const runAndSendCodexReply = async () => {
    const stopTyping = startTypingHeartbeat(transport.sendTyping);
    try {
      const result = await codexRuntimeRequest({
        prompt,
        sessionId: String(session.id),
        codexThreadId,
        recentHistory,
        metadata: {
          transport: "discord",
          discordGuildId: transport.guildId,
          discordChannelId: transport.channelId,
          discordThreadId: transport.threadId,
          adapterCapabilities: {
            adapter: "discord",
            capabilities: ["list-destinations", "send-message"],
            destinationTypes: ["discord-channel"],
          },
          availableOutputDestinations: await listDiscordDestinations().catch((error) => {
            console.warn("[discord-adapter] destination discovery failed", describeError(error));
            return [];
          }),
        },
      });
      const reply = result.responseText;
      codexThreadId = result.codexThreadId ?? codexThreadId;

      if (codexThreadId && codexThreadId !== sessionMeta.codexThreadId) {
        await upsertDiscordSession({
          title: String(session.title ?? `Discord chat: ${prompt.slice(0, 80)}`),
          discordGuildId: transport.guildId,
          discordChannelId: transport.channelId,
          discordThreadId: transport.threadId,
          meta: {
            ...sessionMeta,
            transport: "discord",
            channelName: transport.channelName,
            threadName: transport.threadName,
            codexThreadId,
            codexProvider: "codex-cli",
          },
          lastMessageAt: nowUtcIso(),
        });
      }

      const sent = await transport.sendAssistantMessage(reply);
      await appendSessionMessage({
        sessionId: String(session.id),
        role: "assistant",
        source: "discord",
        sourceMessageId: sent.sourceMessageId,
        content: reply,
        meta: { inThread: Boolean(transport.threadId), codexThreadId },
        createdAt: nowUtcIso(),
      });
    } catch (error) {
      const errorMessage = describeError(error);
      const reply =
        "I hit a chat-engine error. This bridge can keep the Discord thread and session state, but the model-backed reply path is not available right now. " +
        `Error: ${errorMessage}`;
      const sent = await transport.sendAssistantMessage(reply);
      await appendSessionMessage({
        sessionId: String(session.id),
        role: "assistant",
        source: "discord",
        sourceMessageId: sent.sourceMessageId,
        content: reply,
        meta: { inThread: Boolean(transport.threadId), codexThreadId, failed: true },
        createdAt: nowUtcIso(),
      });
    } finally {
      stopTyping();
    }
  };

  if (isAsyncChangeRequestCommand(prompt)) {
    const ack = buildAsyncChangeRequestAck(prompt);
    const sent = await transport.sendAssistantMessage(ack);
    await appendSessionMessage({
      sessionId: String(session.id),
      role: "assistant",
      source: "discord",
      sourceMessageId: sent.sourceMessageId,
      content: ack,
      meta: { inThread: Boolean(transport.threadId), codexThreadId, asyncAck: true },
      createdAt: nowUtcIso(),
    });
    void runAndSendCodexReply();
    return;
  }

  await runAndSendCodexReply();
}

async function enqueueDiscordPrompt(queueKey: string, run: () => Promise<void>): Promise<void> {
  const previous = discordPromptQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  discordPromptQueues.set(
    queueKey,
    next.finally(() => {
      if (discordPromptQueues.get(queueKey) === next) {
        discordPromptQueues.delete(queueKey);
      }
    }),
  );
  return next;
}

async function handleDiscordChatMessage(message: Message): Promise<void> {
  if (!bridgeClient?.user) {
    return;
  }
  const guildId = (process.env.DISCORD_GUILD_ID ?? "").trim();
  if (!guildId || !shouldHandleMessage(message, bridgeClient.user.id, guildId)) {
    return;
  }
  const prompt = cleanPrompt(message, bridgeClient.user.id);
  if (!prompt) {
    return;
  }
  const targetChannel = (await ensureConversationThread(message)) ?? message.channel;
  const threadId = targetChannel.isThread() ? targetChannel.id : null;
  const channelId = targetChannel.isThread() ? targetChannel.parentId : targetChannel.id;
  if (!channelId) {
    return;
  }
  console.log("[discord-adapter] handling mention prompt", {
    guildId: message.guildId,
    messageId: message.id,
    sourceChannelId: message.channel.id,
    targetChannelId: "id" in targetChannel ? targetChannel.id : null,
    targetIsThread: targetChannel.isThread(),
    threadId,
    channelId,
  });
  await enqueueDiscordPrompt(threadId ?? channelId, async () => {
    await runDiscordPrompt(prompt, {
      guildId: message.guildId!,
      channelId,
      threadId,
      channelName: "name" in message.channel ? message.channel.name : null,
      threadName: targetChannel.isThread() ? targetChannel.name : null,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.displayName,
      userSourceMessageId: message.id,
      createdAt: message.createdAt.toISOString(),
      sendTyping:
        "sendTyping" in targetChannel && typeof targetChannel.sendTyping === "function"
          ? async () => {
              await targetChannel.sendTyping();
            }
          : undefined,
      sendAssistantMessage: async (content) => {
        const parts = splitDiscordMessage(content);
        let firstMessageId: string | null = null;
        for (const part of parts) {
          const sent = await sendReply(targetChannel, part);
          if (!firstMessageId && sent?.id) {
            firstMessageId = sent.id;
          }
        }
        return { sourceMessageId: firstMessageId };
      },
    });
  });
}

function discordCommandDefinitions() {
  return [
    new SlashCommandBuilder().setName("prism-ping").setDescription("Simple adapter health check."),
    new SlashCommandBuilder().setName("prism-health").setDescription("Show Prism Discord adapter health."),
    new SlashCommandBuilder()
      .setName("prism-chat")
      .setDescription("Chat with Prism/Codex in this channel.")
      .addStringOption((option) => option.setName("prompt").setDescription("What Prism should do or answer.").setRequired(true)),
    new SlashCommandBuilder().setName("prism-start-cr").setDescription("Start the latest actionable change request."),
    new SlashCommandBuilder()
      .setName("prism-continue-cr")
      .setDescription("Continue work on a specific change request.")
      .addIntegerOption((option) => option.setName("id").setDescription("Change request id.").setRequired(true)),
    new SlashCommandBuilder().setName("prism-join").setDescription("Join your current voice channel."),
    new SlashCommandBuilder().setName("prism-record").setDescription("Start recording the current meeting."),
    new SlashCommandBuilder().setName("prism-stoprecord").setDescription("Stop recording the current meeting."),
    new SlashCommandBuilder().setName("prism-rollcall").setDescription("Show who is currently in the meeting voice channel."),
  ].map((command) => command.toJSON());
}

function voiceTranscriptionConfigured(): boolean {
  return Boolean(
    (process.env.VOICE_TRANSCRIPTION_BASE_URL ?? "").trim()
    && (process.env.VOICE_TRANSCRIPTION_API_KEY ?? "").trim(),
  );
}

function voiceTranscriptionSetupMessage(): string {
  return [
    "Voice transcription is not configured for this Prism deployment.",
    "Set `VOICE_TRANSCRIPTION_BASE_URL` and `VOICE_TRANSCRIPTION_API_KEY` on the `discord-adapter` service, then redeploy it before using `/prism-record` or `/prism-stoprecord`.",
  ].join("\n");
}

async function handleVoiceCommand(interaction: ChatInputCommandInteraction, action: "join" | "record" | "stoprecord" | "rollcall"): Promise<void> {
  if (!voiceManager) {
    await interaction.reply({ content: "Voice manager is not available in this runtime.", ephemeral: true });
    return;
  }
  if ((action === "record" || action === "stoprecord") && !voiceTranscriptionConfigured()) {
    await interaction.reply({ content: voiceTranscriptionSetupMessage(), ephemeral: true });
    return;
  }
  try {
    await interaction.deferReply({ ephemeral: true });
    let content = "";
    let publicContent: string | null = null;
    switch (action) {
      case "join":
        content = await voiceManager.join(interaction);
        break;
      case "record":
        content = await voiceManager.startRecording(interaction);
        break;
      case "stoprecord": {
        await interaction.editReply({ content: "Stopping the recording and processing the transcript. This can take a few minutes." });
        const result = await voiceManager.stopRecording(interaction);
        content = result.privateMessage;
        publicContent = result.publicMessage ?? null;
        break;
      }
      case "rollcall":
        content = await voiceManager.rollcall(interaction);
        break;
    }
    await interaction.editReply({ content });
    if (publicContent && interaction.channel && interaction.channel.isSendable()) {
      await interaction.channel.send(publicContent);
    }
  } catch (error) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: describeError(error) });
      return;
    }
    await interaction.reply({ content: describeError(error), ephemeral: true });
  }
}

async function registerDiscordCommands(client: Client): Promise<void> {
  const config = adapterConfig();
  if (!config.discordRegisterCommands) {
    return;
  }
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  const applicationId = config.discordApplicationId || client.application?.id || client.user?.id;
  if (!token || !applicationId) {
    console.warn("[discord-adapter] command registration skipped: missing token or application id");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(token);
  const body = discordCommandDefinitions();
  console.log(
    "[discord-adapter] command payload",
    JSON.stringify(
      body.map((command) => ({
        name: command.name,
        nameLength: command.name.length,
        descriptionLength: command.description.length,
      })),
    ),
  );
  if (config.discordCommandGuildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, config.discordCommandGuildId), { body });
    console.log(`[discord-adapter] registered ${body.length} guild commands for ${config.discordCommandGuildId}`);
    return;
  }
  await rest.put(Routes.applicationCommands(applicationId), { body });
  console.log(`[discord-adapter] registered ${body.length} global commands`);
}

async function handleDiscordInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return;
  }
  switch (interaction.commandName) {
    case "prism-ping":
      await interaction.reply({ content: "pong", ephemeral: true });
      return;
    case "prism-health": {
      const health = await healthPayload(interaction);
      const discord = health.discord as JsonObject;
      const textChannel = (health.textChannel ?? {}) as JsonObject;
      const voiceChannel = (health.voiceChannel ?? {}) as JsonObject;
      await interaction.reply({
        content: [
          `ok=${health.ok} ready=${discord.discordReady ? "true" : "false"} user=${String(discord.discordUserTag ?? "unknown")}`,
          `text_channel=${String(textChannel.name ?? "unknown")} view=${String(textChannel.canViewChannel ?? "n/a")} send=${String(textChannel.canSendMessages ?? "n/a")} threads=${String(textChannel.canSendMessagesInThreads ?? "n/a")} history=${String(textChannel.canReadMessageHistory ?? "n/a")}`,
          `voice_channel=${String(voiceChannel.name ?? "none")} view=${String(voiceChannel.canViewChannel ?? "n/a")} connect=${String(voiceChannel.canConnect ?? "n/a")} speak=${String(voiceChannel.canSpeak ?? "n/a")} vad=${String(voiceChannel.canUseVoiceActivity ?? "n/a")}`,
          `voice_transcription=${String((health.voice as JsonObject).transcriptionConfigured ?? "false")}`,
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }
    case "prism-chat":
      await handleSlashPrompt(interaction, interaction.options.getString("prompt", true));
      return;
    case "prism-start-cr":
      await handleSlashPrompt(interaction, "start latest change request");
      return;
    case "prism-continue-cr":
      await handleSlashPrompt(interaction, `continue work on CR #${interaction.options.getInteger("id", true)}`);
      return;
    case "prism-join":
      await handleVoiceCommand(interaction, "join");
      return;
    case "prism-record":
      await handleVoiceCommand(interaction, "record");
      return;
    case "prism-stoprecord":
      await handleVoiceCommand(interaction, "stoprecord");
      return;
    case "prism-rollcall":
      await handleVoiceCommand(interaction, "rollcall");
      return;
    default:
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
  }
}

async function handleSlashPrompt(interaction: ChatInputCommandInteraction, prompt: string): Promise<void> {
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({ content: "This command must be used in a text channel or thread.", ephemeral: true });
    return;
  }
  const channel = interaction.channel;
  const threadId = channel.isThread() ? channel.id : null;
  const channelId = channel.isThread() ? channel.parentId : channel.id;
  if (!channelId) {
    await interaction.reply({ content: "I could not resolve the channel for this command.", ephemeral: true });
    return;
  }
  await interaction.deferReply();
  let followupCount = 0;
  await runDiscordPrompt(prompt, {
    guildId: interaction.guildId!,
    channelId,
    threadId,
    channelName: "name" in channel ? channel.name : null,
    threadName: channel.isThread() ? channel.name : null,
    authorId: interaction.user.id,
    authorName: interaction.member && "displayName" in interaction.member ? String(interaction.member.displayName) : interaction.user.displayName,
    userSourceMessageId: interaction.id,
    createdAt: interaction.createdAt.toISOString(),
    sendTyping: async () => {},
    sendAssistantMessage: async (content) => {
      const parts = splitDiscordMessage(content);
      let firstMessageId: string | null = null;
      for (const part of parts) {
        if (followupCount === 0) {
          followupCount += 1;
          await interaction.editReply({ content: part });
          const reply = await interaction.fetchReply();
          if (!firstMessageId) {
            firstMessageId = reply.id;
          }
          continue;
        }
        const followup = await interaction.followUp({ content: part });
        followupCount += 1;
        if (!firstMessageId) {
          firstMessageId = followup.id;
        }
      }
      return { sourceMessageId: firstMessageId };
    },
  });
}

async function startDiscordBridge(): Promise<void> {
  const config = adapterConfig();
  const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (config.sourceKind !== "discord" || !config.discordChatEnabled || !token) {
    console.log("[discord-adapter] Discord bridge disabled or token missing");
    return;
  }
  bridgeClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
  });
  voiceManager = new DiscordVoiceManager({
    client: bridgeClient,
    dataRoot: dataRoot(),
    publicBaseUrl: sourceAdapterPublicBaseUrl,
    describeError,
  });
  await voiceManager.init();
  bridgeClient.once(Events.ClientReady, (client) => {
    discordReady = true;
    discordUserTag = client.user.tag;
    console.log(`[discord-adapter] connected as ${client.user.tag}`);
    void registerDiscordCommands(client).catch((error) => {
      console.error("[discord-adapter] command registration failed", describeError(error), error);
    });
  });
  bridgeClient.on(Events.MessageCreate, (message) => {
    void handleDiscordChatMessage(message).catch((error) => {
      console.error("[discord-adapter] message handling failed", describeError(error));
    });
  });
  bridgeClient.on(Events.InteractionCreate, (interaction) => {
    void handleDiscordInteraction(interaction).catch((error) => {
      console.error("[discord-adapter] interaction handling failed", describeError(error));
    });
  });
  bridgeClient.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (!voiceManager) {
      return;
    }
    void voiceManager.handleVoiceStateUpdate(oldState, newState).catch((error) => {
      console.error("[discord-adapter] voice state handling failed", describeError(error));
    });
  });
  bridgeClient.on(Events.ShardDisconnect, () => {
    discordReady = false;
  });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await bridgeClient.login(token);
      return;
    } catch (error) {
      console.error(`[discord-adapter] login attempt ${attempt} failed`, describeError(error));
      if (attempt === 5) {
        throw error;
      }
      await sleep(2_000 * attempt);
    }
  }
}

async function healthPayload(interaction?: ChatInputCommandInteraction): Promise<JsonObject> {
  const payload: JsonObject = {
    ok: true,
    service: "source-adapter",
    timestamp: nowUtcIso(),
    config: adapterConfig(),
    checkpoint: await currentCheckpoint(adapterConfig()),
    dataRoot: dataRoot(),
    discord: {
      discordReady,
      discordUserTag,
    },
    voice: {
      transcriptionConfigured: voiceTranscriptionConfigured(),
    },
  };
  if (!interaction?.guild || !interaction.channel) {
    return payload;
  }
  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe().catch(() => null));
  const textPermissions = me && "permissionsFor" in interaction.channel
    ? interaction.channel.permissionsFor(me)
    : null;
  payload.textChannel = {
    id: "id" in interaction.channel ? interaction.channel.id : null,
    name: "name" in interaction.channel ? String(interaction.channel.name ?? "unknown") : "unknown",
    canViewChannel: textPermissions?.has(PermissionFlagsBits.ViewChannel) ?? null,
    canSendMessages: textPermissions?.has(PermissionFlagsBits.SendMessages) ?? null,
    canCreatePublicThreads: textPermissions?.has(PermissionFlagsBits.CreatePublicThreads) ?? null,
    canSendMessagesInThreads: textPermissions?.has(PermissionFlagsBits.SendMessagesInThreads) ?? null,
    canReadMessageHistory: textPermissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? null,
  };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const voiceChannel = member?.voice.channel;
  if (!voiceChannel) {
    payload.voiceChannel = {
      name: null,
      canViewChannel: null,
      canConnect: null,
      canSpeak: null,
      canUseVoiceActivity: null,
    };
    return payload;
  }
  const voicePermissions = me ? voiceChannel.permissionsFor(me) : null;
  payload.voiceChannel = {
    id: voiceChannel.id,
    name: voiceChannel.name,
    canViewChannel: voicePermissions?.has(PermissionFlagsBits.ViewChannel) ?? null,
    canConnect: voicePermissions?.has(PermissionFlagsBits.Connect) ?? null,
    canSpeak: voicePermissions?.has(PermissionFlagsBits.Speak) ?? null,
    canUseVoiceActivity: voicePermissions?.has(PermissionFlagsBits.UseVAD) ?? null,
  };
  return payload;
}

async function runSync(dryRun: boolean, resetCheckpoint: boolean): Promise<JsonObject> {
  const { payload, summary, since, until } = await collectDiscordBatch(resetCheckpoint);
  const posted = dryRun ? null : await postBatchToPrism(payload);
  const checkpoint = await updateCheckpoint(adapterConfig(), {
    since,
    until,
    messageCount: Number(summary.messageCount ?? 0),
    dryRun,
  });
  return {
    ok: true,
    service: "source-adapter",
    timestamp: nowUtcIso(),
    dryRun,
    resetCheckpoint,
    summary,
    checkpoint,
    posted,
  };
}

function requireAdapterToken(request: Request): void {
  const expected = (process.env.SOURCE_ADAPTER_TOKEN ?? "").trim();
  if (!expected) {
    return;
  }
  if ((request.header("X-Adapter-Token") ?? "") !== expected) {
    throw new Error("Unauthorized");
  }
}

async function main(): Promise<void> {
  await fs.mkdir(dataRoot(), { recursive: true });
  await startDiscordBridge();

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", async (_request: Request, response: Response) => {
    response.json(await healthPayload());
  });

  app.get("/capabilities", (_request: Request, response: Response) => {
    response.json({
      ok: true,
      adapter: "discord",
      capabilities: ["list-destinations", "send-message"],
      destinationTypes: ["discord-channel"],
      routes: {
        destinations: "/destinations",
        messages: "/messages",
      },
    });
  });

  app.get("/destinations", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      response.json({
        ok: true,
        adapter: "discord",
        destinations: await listDiscordDestinations(),
      });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/messages", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const body = request.body && typeof request.body === "object" ? request.body as JsonObject : {};
      const destinationId = typeof body.destinationId === "string"
        ? body.destinationId
        : typeof body.destination_id === "string"
          ? body.destination_id
          : "";
      const content = typeof body.content === "string" ? body.content : "";
      response.json({
        ok: true,
        result: await sendDiscordMessage(destinationId, content),
      });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/sync", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      const dryRun = `${request.query.dry_run ?? "false"}` === "true";
      const resetCheckpoint = `${request.query.reset_checkpoint ?? "false"}` === "true";
      response.json(await runSync(dryRun, resetCheckpoint));
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.get("/recordings/:sessionId/:fileName", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      if (!voiceManager) {
        response.status(503).json({ ok: false, error: "VOICE_MANAGER_UNAVAILABLE" });
        return;
      }
      const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId[0] : request.params.sessionId;
      const fileName = Array.isArray(request.params.fileName) ? request.params.fileName[0] : request.params.fileName;
      const resolved = await voiceManager.resolveRecordingDownload(sessionId, fileName);
      if (!resolved) {
        response.status(404).json({ ok: false, error: "RECORDING_NOT_FOUND" });
        return;
      }
      response.type(resolved.contentType);
      response.sendFile(resolved.filePath);
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  app.post("/recordings/:sessionId/recover", async (request: Request, response: Response) => {
    try {
      requireAdapterToken(request);
      if (!voiceManager) {
        response.status(503).json({ ok: false, error: "VOICE_MANAGER_UNAVAILABLE" });
        return;
      }
      const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId[0] : request.params.sessionId;
      const metadata = await voiceManager.recoverRecordingSession(sessionId);
      response.json({ ok: true, metadata });
    } catch (error) {
      const message = describeError(error);
      response.status(message === "Unauthorized" ? 401 : 500).json({ ok: false, error: message });
    }
  });

  const port = Number(process.env.PORT ?? "8789");
  app.listen(port, () => {
    console.log(`[source-adapter] listening on ${port}`);
  });

  const shutdown = async () => {
    if (bridgeClient) {
      await bridgeClient.destroy();
      bridgeClient = null;
    }
    voiceManager = null;
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error("[source-adapter] fatal", describeError(error));
  process.exit(1);
});
