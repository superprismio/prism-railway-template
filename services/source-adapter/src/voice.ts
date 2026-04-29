import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import type {
  ChatInputCommandInteraction,
  Client,
  Guild,
  GuildMember,
  TextBasedChannel,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";
import { createWriteStream, type WriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import prism from "prism-media";

const voiceDaveEncryptionRaw = process.env.VOICE_DAVE_ENCRYPTION?.trim().toLowerCase();
const voiceDaveEncryptionExplicit = Boolean(voiceDaveEncryptionRaw);
const voiceDaveEncryptionEnabled = voiceDaveEncryptionRaw ? voiceDaveEncryptionRaw === "true" : true;

export type VoiceChunkMetadata = {
  audioUrl: string | null;
  index: number;
  startMs?: number;
  endMs?: number;
  byteStart: number;
  byteEnd: number;
  fileName: string;
  contentType: string;
};

export type SpeakerMetadata = {
  userId: string;
  username: string;
  duration: number;
  audioUrl: string | null;
  chunks: VoiceChunkMetadata[];
  rawPath: string;
};

export type ParticipantPresence = {
  userId: string;
  username: string;
  joinedAt: number;
  leftAt?: number;
  didSpeak: boolean;
};

export type RecordingWebhookMetadata = {
  meeting: {
    name?: string;
    platform: "discord";
    channel_id: string;
    attendee_ids: string[];
    attendee_count: number;
    location?: string;
    timezone?: string;
  };
  sys: {
    event_name: "meeting.held";
    time_window: {
      start: string;
      end: string;
    };
  };
};

export type RecordingSessionMetadata = {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  channelId: string;
  guildId: string;
  speakers: SpeakerMetadata[];
  participants: ParticipantPresence[];
  metadata: RecordingWebhookMetadata;
  source: {
    service: "source-adapter";
    transport: "discord";
    storage: "local-volume";
    recordingBaseUrl: string | null;
    authHeader: "X-Adapter-Token";
  };
  artifacts?: {
    transcriptJsonPath?: string;
    transcriptMarkdownPath?: string;
    summaryJsonPath?: string;
    summaryMarkdownPath?: string;
    prismMemoryTranscriptPath?: string;
    prismMemorySummaryPath?: string;
  };
};

export type StopRecordingResult = {
  privateMessage: string;
  publicMessage?: string | null;
};

type TranscriptionSegment = {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speakerId: string;
  chunkIndex?: number;
  source: "voice" | "chat";
  messageId?: string;
  jumpUrl?: string;
  timestamp?: string;
};

type SpeakerTranscript = {
  userId: string;
  username: string;
  text: string;
  segments: TranscriptionSegment[];
};

type SessionTranscriptArtifacts = {
  speakerTranscripts: SpeakerTranscript[];
  chatMessages: TranscriptionSegment[];
  mergedSegments: TranscriptionSegment[];
  mergedTranscript: string;
  transcriptJsonPath: string;
  transcriptMarkdownPath: string;
};

type SessionSummary = {
  title: string;
  tldr: string;
  summary: string;
  actionItems: Array<{
    name: string;
    description: string;
    assignedTo: string | null;
    dueDate: string | null;
    params: Record<string, string>;
  }>;
  notableQuotes: Array<{
    author: string;
    quote: string;
    paraphrase: string;
  }>;
  tags: string[];
  raw?: unknown;
  summaryJsonPath: string;
  summaryMarkdownPath: string;
};

type VoiceTranscriptionResponse = {
  text?: string;
  duration?: number;
  timestamps?: {
    segment?: Array<{
      text?: string;
      start?: number;
      end?: number;
    }>;
  };
};

type JsonObject = Record<string, unknown>;

type VoiceConnectionState = {
  channelId: string;
  channelName: string;
  connection: VoiceConnection;
  receiverStartHandler: (userId: string) => void;
};

type SpeakerStream = {
  userId: string;
  username: string;
  filename: string;
  rawPath: string;
  stream?: WriteStream;
  startedAt: number;
  didSpeak: boolean;
};

type ActiveAudioStream = {
  userId: string;
  opusStream: NodeJS.ReadableStream;
  oggStream: NodeJS.ReadWriteStream;
  startedAt: number;
  receivedOpus: boolean;
  pipelinePromise: Promise<void>;
};

type RecordingSession = {
  sessionId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  startedAt: number;
  rootDir: string;
  rawDir: string;
  flacDir: string;
  transcriptDir: string;
  participants: Map<string, ParticipantPresence>;
  speakers: Map<string, SpeakerStream>;
  activeAudioStreams: Map<string, ActiveAudioStream>;
  speakingHandler: (userId: string) => void;
  speakingEndHandler: (userId: string) => void;
  connectionSpeakingHandler: (userId: string, speaking: boolean) => void;
  recoveredFromDisk?: boolean;
};

type PersistedRecordingSession = {
  sessionId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  startedAt: string;
  participants?: Array<{
    userId: string;
    username: string;
    joinedAt?: string;
    leftAt?: string;
    didSpeak?: boolean;
  }>;
};

type VoiceManagerOptions = {
  client: Client;
  dataRoot: string;
  publicBaseUrl: () => string | null;
  describeError: (error: unknown) => string;
};

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "user";
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return parsed;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

export class DiscordVoiceManager {
  private readonly client: Client;
  private readonly dataRoot: string;
  private readonly publicBaseUrl: () => string | null;
  private readonly describeError: (error: unknown) => string;
  private readonly connections = new Map<string, VoiceConnectionState>();
  private readonly sessionsByGuild = new Map<string, RecordingSession>();
  private readonly activeUserStreams = new Map<string, Map<string, ActiveAudioStream>>();
  private readonly ffmpegSegmentSeconds = Number.parseInt(process.env.VOICE_FFMPEG_SEGMENT_SECONDS ?? "180", 10) || 180;
  private readonly voiceChatMaxMessages = Number.parseInt(process.env.VOICE_CHAT_MAX_MESSAGES ?? "200", 10) || 200;
  private readonly recordingsRoot: string;

  constructor(options: VoiceManagerOptions) {
    this.client = options.client;
    this.dataRoot = options.dataRoot;
    this.publicBaseUrl = options.publicBaseUrl;
    this.describeError = options.describeError;
    this.recordingsRoot = path.join(this.dataRoot, "recordings");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.recordingsRoot, { recursive: true });
  }

  private async resolveMemberVoiceChannel(interaction: ChatInputCommandInteraction): Promise<{ guild: Guild; member: GuildMember; channel: VoiceBasedChannel }> {
    if (!interaction.guildId || !interaction.guild) {
      throw new Error("This command must be used inside a Discord server.");
    }
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    if (!channel || !channel.isVoiceBased()) {
      throw new Error(`Join a voice channel first, then run \`/${interaction.commandName}\`.`);
    }
    return { guild: interaction.guild, member, channel };
  }

  private ensureParticipant(session: RecordingSession, member: GuildMember): ParticipantPresence {
    const existing = session.participants.get(member.user.id);
    if (existing) {
      existing.username = member.displayName;
      existing.leftAt = undefined;
      return existing;
    }
    const participant: ParticipantPresence = {
      userId: member.user.id,
      username: member.displayName,
      joinedAt: Date.now(),
      didSpeak: false,
    };
    session.participants.set(participant.userId, participant);
    return participant;
  }

  private async ensureVoiceConnection(guild: Guild, channel: VoiceBasedChannel): Promise<VoiceConnectionState> {
    const existing = this.connections.get(guild.id);
    if (existing && existing.channelId === channel.id) {
      return existing;
    }
    if (existing) {
      existing.connection.receiver.speaking.off("start", existing.receiverStartHandler);
      existing.connection.destroy();
      this.connections.delete(guild.id);
    }
    const createConnection = (daveEncryption: boolean) =>
      joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        daveEncryption,
      });
    const attachConnectionLogging = (connectionToLog: VoiceConnection) => {
      connectionToLog.on("error", (error) => {
        console.warn(`[discord-adapter] voice connection error guild=${guild.id}: ${this.describeError(error)}`);
      });
      connectionToLog.on("stateChange", (oldState, newState) => {
        if (oldState.status !== newState.status) {
          console.log(`[discord-adapter] voice connection state guild=${guild.id} ${oldState.status}->${newState.status}`);
        }
      });
    };
    let connection = createConnection(voiceDaveEncryptionEnabled);
    console.log(
      `[discord-adapter] joining voice guild=${guild.id} channel=${channel.id} daveEncryption=${voiceDaveEncryptionEnabled ? "true" : "false"}${voiceDaveEncryptionExplicit ? "" : " default"}`,
    );
    attachConnectionLogging(connection);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
    } catch (error) {
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      const joinedTargetChannel = me?.voice.channelId === channel.id;
      if (!joinedTargetChannel) {
        connection.destroy();
        if (voiceDaveEncryptionEnabled && !voiceDaveEncryptionExplicit) {
          console.warn(
            `[discord-adapter] voice join failed with default DAVE encryption for guild ${guild.id}; retrying with daveEncryption=false`,
            this.describeError(error),
          );
          connection = createConnection(false);
          attachConnectionLogging(connection);
          await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
        } else {
          throw error;
        }
      } else {
        console.warn(
          `[discord-adapter] voice join ready-wait failed for guild ${guild.id}, but bot is present in ${channel.id}; continuing`,
          this.describeError(error),
        );
      }
    }
    const receiverStartHandler = (userId: string) => {
      const activeSession = this.sessionsByGuild.get(guild.id);
      if (!activeSession) {
        return;
      }
      console.log(`[discord-adapter] receiver speaking start session=${activeSession.sessionId} user=${userId}`);
      void this.beginSpeakerCapture(activeSession, userId).catch((error) => {
        console.error("[discord-adapter] receiver speaker capture failed", this.describeError(error));
      });
    };
    connection.receiver.speaking.on("start", receiverStartHandler);

    const state: VoiceConnectionState = {
      channelId: channel.id,
      channelName: channel.name,
      connection,
      receiverStartHandler,
    };
    this.connections.set(guild.id, state);
    return state;
  }

  async join(interaction: ChatInputCommandInteraction): Promise<string> {
    const { guild, channel } = await this.resolveMemberVoiceChannel(interaction);
    await this.ensureVoiceConnection(guild, channel);
    return `Joined **${channel.name}**.`;
  }

  async startRecording(interaction: ChatInputCommandInteraction): Promise<string> {
    const { guild, channel } = await this.resolveMemberVoiceChannel(interaction);
    const active = this.sessionsByGuild.get(guild.id);
    if (active) {
      return `Already recording in **${active.channelName}** with session \`${active.sessionId}\`.`;
    }

    const connectionState = await this.ensureVoiceConnection(guild, channel);
    const sessionId = randomUUID();
    const rootDir = path.join(this.recordingsRoot, sessionId);
    const rawDir = path.join(rootDir, "raw");
    const flacDir = path.join(rootDir, "flac");
    const transcriptDir = path.join(rootDir, "transcript");
    await fs.mkdir(rawDir, { recursive: true });
    await fs.mkdir(flacDir, { recursive: true });
    await fs.mkdir(transcriptDir, { recursive: true });

    const session: RecordingSession = {
      sessionId,
      guildId: guild.id,
      channelId: channel.id,
      channelName: channel.name,
      startedAt: Date.now(),
      rootDir,
      rawDir,
      flacDir,
      transcriptDir,
      participants: new Map(),
      speakers: new Map(),
      activeAudioStreams: new Map(),
      speakingHandler: (_userId: string) => {},
      speakingEndHandler: (_userId: string) => {},
      connectionSpeakingHandler: (_userId: string, _speaking: boolean) => {},
    };

    for (const member of channel.members.values()) {
      if (!member.user.bot) {
        this.ensureParticipant(session, member);
      }
    }

    console.log(
      `[discord-adapter] start recording session=${sessionId} guild=${guild.id} channel=${channel.id} participants=${JSON.stringify(
        [...session.participants.values()].map((participant) => ({
          userId: participant.userId,
          username: participant.username,
        })),
      )}`,
    );
    this.activeUserStreams.set(guild.id, new Map());
    this.sessionsByGuild.set(guild.id, session);

    const participantIds = [...session.participants.keys()];
    if (participantIds.length > 0) {
      console.log(
        `[discord-adapter] eager receiver subscribe session=${sessionId} participants=${JSON.stringify(participantIds)}`,
      );
      const subscribeResults = await Promise.allSettled(
        participantIds.map((userId) => this.beginSpeakerCapture(session, userId)),
      );
      subscribeResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.warn(
            `[discord-adapter] eager receiver subscribe failed session=${sessionId} user=${participantIds[index]}: ${this.describeError(result.reason)}`,
          );
        }
      });
    }

    await fs.writeFile(
      path.join(rootDir, "session.json"),
      `${JSON.stringify({
        sessionId,
        guildId: guild.id,
        channelId: channel.id,
        channelName: channel.name,
        startedAt: new Date(session.startedAt).toISOString(),
        participants: [...session.participants.values()].map((participant) => ({
          userId: participant.userId,
          username: participant.username,
          joinedAt: new Date(participant.joinedAt).toISOString(),
          leftAt: participant.leftAt ? new Date(participant.leftAt).toISOString() : undefined,
          didSpeak: participant.didSpeak,
        })),
      }, null, 2)}\n`,
      "utf8",
    );

    return `Recording started in **${channel.name}**.\nSession: \`${sessionId}\`\nRaw audio is being written to \`${rootDir}\`.`;
  }

  private async beginSpeakerCapture(session: RecordingSession, userId: string): Promise<void> {
    const guildStreams = this.activeUserStreams.get(session.guildId) ?? new Map<string, ActiveAudioStream>();
    this.activeUserStreams.set(session.guildId, guildStreams);
    const existingStream = guildStreams.get(userId) ?? session.activeAudioStreams.get(userId);
    if (existingStream) {
      return;
    }
    const guild = await this.client.guilds.fetch(session.guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    const username = member?.displayName ?? member?.user.username ?? userId;
    if (member && !member.user.bot) {
      this.ensureParticipant(session, member);
    }
    const speaker = await this.ensureSpeakerStream(session, userId, username);
    const connectionState = this.connections.get(session.guildId);
    if (!connectionState) {
      throw new Error(`No voice connection found for guild ${session.guildId}`);
    }

    console.log(`[discord-adapter] begin speaker capture session=${session.sessionId} user=${userId} name=${username}`);
    console.log(
      `[discord-adapter] receiver subscribe session=${session.sessionId} user=${userId} channel=${session.channelId} existingStreams=${guildStreams.size}`,
    );

    const opusStream = connectionState.connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });
    const oggStream = new prism.opus.OggLogicalBitstream({
      opusHead: new prism.opus.OpusHead({
        channelCount: 2,
        sampleRate: 48_000,
      }),
      pageSizeControl: {
        maxPackets: 10,
      },
    });
    if (!speaker.stream) {
      throw new Error(`Recovered speaker stream cannot be reused for live capture: ${userId}`);
    }
    const pipelinePromise = pipeline(opusStream as any, oggStream as any, speaker.stream) as Promise<void>;
    const activeStream: ActiveAudioStream = {
      userId,
      opusStream,
      oggStream,
      startedAt: Date.now(),
      receivedOpus: false,
      pipelinePromise,
    };
    session.activeAudioStreams.set(userId, activeStream);
    guildStreams.set(userId, activeStream);

    let loggedFirstOpusChunk = false;
    let opusChunkCount = 0;
    let opusBytes = 0;
    opusStream.on("data", (chunk: Buffer) => {
      activeStream.receivedOpus = true;
      opusChunkCount += 1;
      opusBytes += chunk.length;
      if (!loggedFirstOpusChunk) {
        loggedFirstOpusChunk = true;
        console.log(
          `[discord-adapter] received first opus chunk session=${session.sessionId} user=${userId} bytes=${chunk.length}`,
        );
      }
      speaker.didSpeak = true;
      const participant = session.participants.get(userId);
      if (participant) {
        participant.didSpeak = true;
      }
    });

    const cleanup = (reason: string) => {
      const lifetimeMs = Date.now() - activeStream.startedAt;
      console.log(
        `[discord-adapter] cleanup speaker stream session=${session.sessionId} user=${userId} reason=${reason} lifetimeMs=${lifetimeMs} opusChunks=${opusChunkCount} opusBytes=${opusBytes} receivedOpus=${activeStream.receivedOpus ? "true" : "false"}`,
      );
      session.activeAudioStreams.delete(userId);
      const streams = this.activeUserStreams.get(session.guildId);
      if (streams) {
        streams.delete(userId);
        if (streams.size === 0) {
          this.activeUserStreams.delete(session.guildId);
        }
      }
    };

    opusStream.on("error", (error: Error) => {
      console.error(`[discord-adapter] opus stream error for user ${userId}:`, error.message);
    });
    opusStream.on("end", () => cleanup("opus_end"));
    opusStream.on("close", () => cleanup("opus_close"));
    oggStream.on("end", () => cleanup("ogg_end"));
    oggStream.on("close", () => cleanup("ogg_close"));
    oggStream.on("error", (error: Error) => {
      console.error(`[discord-adapter] ogg stream error for user ${userId}:`, error.message);
      cleanup("ogg_error");
    });
  }

  private async ensureSpeakerStream(session: RecordingSession, userId: string, username: string): Promise<SpeakerStream> {
    const existing = session.speakers.get(userId);
    if (existing) {
      return existing;
    }
    const filename = `${userId}-${sanitizeFileSegment(username)}-${Date.now()}.ogg`;
    const rawPath = path.join(session.rawDir, filename);
    const stream = createWriteStream(rawPath);
    const speaker: SpeakerStream = {
      userId,
      username,
      filename,
      rawPath,
      stream,
      startedAt: Date.now(),
      didSpeak: false,
    };
    session.speakers.set(userId, speaker);
    return speaker;
  }

  private async recoverLatestSessionFromDisk(guildId: string): Promise<RecordingSession | null> {
    const entries = await fs.readdir(this.recordingsRoot, { withFileTypes: true }).catch(() => []);
    const candidates: Array<{ session: PersistedRecordingSession; rootDir: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const rootDir = path.join(this.recordingsRoot, entry.name);
      const metadataPath = path.join(rootDir, "metadata.json");
      if (await fileExists(metadataPath)) {
        continue;
      }
      const sessionPath = path.join(rootDir, "session.json");
      const raw = await fs.readFile(sessionPath, "utf8").catch(() => null);
      if (!raw) {
        continue;
      }
      try {
        const session = JSON.parse(raw) as PersistedRecordingSession;
        if (session.guildId === guildId && session.sessionId && session.channelId && session.startedAt) {
          candidates.push({ session, rootDir });
        }
      } catch (error) {
        console.warn(`[discord-adapter] skipped corrupt recording session file ${sessionPath}: ${this.describeError(error)}`);
      }
    }

    candidates.sort((left, right) => parseIsoDate(right.session.startedAt).getTime() - parseIsoDate(left.session.startedAt).getTime());
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    return this.buildRecoveredSession(candidate.session, candidate.rootDir);
  }

  private async recoverSessionFromDisk(sessionId: string): Promise<RecordingSession | null> {
    const safeSessionId = path.basename(sessionId);
    if (safeSessionId !== sessionId) {
      throw new Error("Invalid recording session id");
    }
    const rootDir = path.join(this.recordingsRoot, safeSessionId);
    const metadataPath = path.join(rootDir, "metadata.json");
    if (await fileExists(metadataPath)) {
      return null;
    }
    const raw = await fs.readFile(path.join(rootDir, "session.json"), "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as PersistedRecordingSession;
    if (session.sessionId !== safeSessionId) {
      throw new Error(`Recording session id mismatch in ${safeSessionId}`);
    }
    return this.buildRecoveredSession(session, rootDir);
  }

  private async buildRecoveredSession(candidate: PersistedRecordingSession, rootDir: string): Promise<RecordingSession> {
    const rawDir = path.join(rootDir, "raw");
    const flacDir = path.join(rootDir, "flac");
    const transcriptDir = path.join(rootDir, "transcript");
    await fs.mkdir(flacDir, { recursive: true });
    await fs.mkdir(transcriptDir, { recursive: true });

    const session: RecordingSession = {
      sessionId: candidate.sessionId,
      guildId: candidate.guildId,
      channelId: candidate.channelId,
      channelName: candidate.channelName,
      startedAt: parseIsoDate(candidate.startedAt).getTime(),
      rootDir,
      rawDir,
      flacDir,
      transcriptDir,
      participants: new Map(),
      speakers: new Map(),
      activeAudioStreams: new Map(),
      speakingHandler: (_userId: string) => {},
      speakingEndHandler: (_userId: string) => {},
      connectionSpeakingHandler: (_userId: string, _speaking: boolean) => {},
      recoveredFromDisk: true,
    };

    for (const participant of candidate.participants ?? []) {
      session.participants.set(participant.userId, {
        userId: participant.userId,
        username: participant.username,
        joinedAt: participant.joinedAt ? parseIsoDate(participant.joinedAt).getTime() : session.startedAt,
        leftAt: participant.leftAt ? parseIsoDate(participant.leftAt).getTime() : undefined,
        didSpeak: Boolean(participant.didSpeak),
      });
    }

    const rawFiles = (await fs.readdir(rawDir).catch(() => [])).filter((name) => name.endsWith(".ogg")).sort();
    for (const filename of rawFiles) {
      const rawPath = path.join(rawDir, filename);
      const stat = await fs.stat(rawPath).catch(() => null);
      if (!stat || stat.size === 0) {
        continue;
      }
      const parsed = this.parseRawSpeakerFileName(filename);
      const userId = parsed.userId;
      const username = parsed.username || userId;
      const startedAt = parsed.startedAt ?? session.startedAt;
      const didSpeak = stat.size >= 1024;
      session.speakers.set(userId, {
        userId,
        username,
        filename,
        rawPath,
        startedAt,
        didSpeak,
      });
      const existingParticipant = session.participants.get(userId);
      if (existingParticipant) {
        existingParticipant.didSpeak = existingParticipant.didSpeak || didSpeak;
      } else {
        session.participants.set(userId, {
          userId,
          username,
          joinedAt: session.startedAt,
          didSpeak,
        });
      }
    }

    console.warn(
      `[discord-adapter] recovered unfinished recording session=${session.sessionId} guild=${session.guildId} speakers=${session.speakers.size} participants=${session.participants.size}`,
    );
    return session;
  }

  async recoverRecordingSession(sessionId: string): Promise<RecordingSessionMetadata> {
    for (const session of this.sessionsByGuild.values()) {
      if (session.sessionId === sessionId) {
        return this.finalizeSession(session);
      }
    }
    const metadataPath = path.join(this.recordingsRoot, path.basename(sessionId), "metadata.json");
    const existing = await fs.readFile(metadataPath, "utf8").catch(() => null);
    if (existing) {
      const metadata = JSON.parse(existing) as RecordingSessionMetadata;
      return this.recoverPrismMemoryArtifacts(metadata, metadataPath);
    }
    const session = await this.recoverSessionFromDisk(sessionId);
    if (!session) {
      throw new Error(`Recording session not recoverable: ${sessionId}`);
    }
    return this.finalizeSession(session);
  }

  private async recoverPrismMemoryArtifacts(
    metadata: RecordingSessionMetadata,
    metadataPath: string,
  ): Promise<RecordingSessionMetadata> {
    if (metadata.artifacts?.prismMemoryTranscriptPath || metadata.artifacts?.prismMemorySummaryPath) {
      return metadata;
    }
    const transcriptArtifacts = await this.loadPersistedTranscriptArtifacts(metadata);
    const summary = await this.loadPersistedSummary(metadata);
    const memoryIngest = await this.ingestArtifactsToPrismMemory(metadata, transcriptArtifacts, summary);
    metadata.artifacts = {
      ...(metadata.artifacts ?? {}),
      prismMemoryTranscriptPath: memoryIngest.transcriptPath ?? undefined,
      prismMemorySummaryPath: memoryIngest.summaryPath ?? undefined,
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    console.log(
      `[discord-adapter] recovered prism memory artifacts session=${metadata.sessionId} transcript=${metadata.artifacts.prismMemoryTranscriptPath ?? "none"} summary=${metadata.artifacts.prismMemorySummaryPath ?? "none"}`,
    );
    return metadata;
  }

  private async loadPersistedTranscriptArtifacts(metadata: RecordingSessionMetadata): Promise<SessionTranscriptArtifacts | null> {
    const transcriptJsonPath = metadata.artifacts?.transcriptJsonPath;
    if (!transcriptJsonPath) {
      return null;
    }
    const raw = await fs.readFile(transcriptJsonPath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionTranscriptArtifacts;
  }

  private async loadPersistedSummary(metadata: RecordingSessionMetadata): Promise<SessionSummary | null> {
    const summaryJsonPath = metadata.artifacts?.summaryJsonPath;
    if (!summaryJsonPath) {
      return null;
    }
    const raw = await fs.readFile(summaryJsonPath, "utf8").catch(() => null);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionSummary;
  }

  private parseRawSpeakerFileName(filename: string): { userId: string; username: string; startedAt?: number } {
    const base = filename.replace(/\.ogg$/i, "");
    const parts = base.split("-");
    const userId = parts.shift() || "unknown";
    const maybeTimestamp = parts[parts.length - 1];
    const startedAt = maybeTimestamp && /^\d+$/.test(maybeTimestamp) ? Number.parseInt(maybeTimestamp, 10) : undefined;
    if (startedAt) {
      parts.pop();
    }
    return {
      userId,
      username: parts.join("-") || userId,
      startedAt,
    };
  }

  async stopRecording(interaction: ChatInputCommandInteraction): Promise<StopRecordingResult> {
    if (!interaction.guildId) {
      throw new Error("This command must be used inside a Discord server.");
    }
    const session = this.sessionsByGuild.get(interaction.guildId) ?? (await this.recoverLatestSessionFromDisk(interaction.guildId));
    if (!session) {
      throw new Error("No active recording session found.");
    }
    console.log(
      `[discord-adapter] stop recording requested session=${session.sessionId} activeStreams=${session.activeAudioStreams.size} trackedParticipants=${session.participants.size}`,
    );
    const metadata = await this.finalizeSession(session);
    const transcriptArtifact = this.prismArtifactReference(metadata.artifacts?.prismMemoryTranscriptPath);
    const summaryArtifact = this.prismArtifactReference(metadata.artifacts?.prismMemorySummaryPath);
    const privateMessage = [
      `Recording stopped for **${session.channelName}**.`,
      `Session: \`${metadata.sessionId}\``,
      session.recoveredFromDisk ? "Recovered unfinished session from the recording volume after adapter restart." : null,
      `Participants: ${metadata.participants.length}`,
      `Speakers with audio: ${metadata.speakers.length}`,
      transcriptArtifact
        ? `Transcript: ${transcriptArtifact.url} (\`${transcriptArtifact.id}\`)`
        : metadata.artifacts?.transcriptMarkdownPath
          ? `Transcript written locally: \`${metadata.artifacts.transcriptMarkdownPath}\``
          : "Transcript not generated.",
      summaryArtifact
        ? `Summary: ${summaryArtifact.url} (\`${summaryArtifact.id}\`)`
        : metadata.artifacts?.summaryMarkdownPath
          ? `Summary written locally: \`${metadata.artifacts.summaryMarkdownPath}\``
          : "Summary not generated.",
      process.env.N8N_WEBHOOK_URL ? "Legacy webhook handoff attempted." : "No legacy webhook handoff configured.",
    ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
    const publicMessage = summaryArtifact
      ? [
          `Meeting summary for **${session.channelName}** is ready: ${summaryArtifact.url}`,
          transcriptArtifact ? `Transcript: ${transcriptArtifact.url}` : null,
        ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n")
      : null;
    return {
      privateMessage,
      publicMessage,
    };
  }

  async finalizeSession(session: RecordingSession): Promise<RecordingSessionMetadata> {
    this.sessionsByGuild.delete(session.guildId);
    const endedAt = Date.now();
    const connectionState = this.connections.get(session.guildId);
    if (connectionState) {
      if (typeof (connectionState.connection as any).off === "function") {
        (connectionState.connection as any).off("speaking", session.connectionSpeakingHandler);
      }
    }

    for (const active of session.activeAudioStreams.values()) {
      if ("destroy" in active.opusStream && typeof active.opusStream.destroy === "function") {
        active.opusStream.destroy();
      }
      if ("destroy" in active.oggStream && typeof active.oggStream.destroy === "function") {
        active.oggStream.destroy();
      }
    }
    await Promise.allSettled([...session.activeAudioStreams.values()].map((active) => active.pipelinePromise));
    session.activeAudioStreams.clear();
    this.activeUserStreams.delete(session.guildId);

    await Promise.all(
      [...session.speakers.values()].map(
        (speaker) =>
          new Promise<void>((resolve) => {
            if (!speaker.stream) {
              resolve();
              return;
            }
            speaker.stream.end(() => resolve());
          }),
      ),
    );

    const speakers: SpeakerMetadata[] = [];
    for (const speaker of session.speakers.values()) {
      const chunks = await this.transcodeSpeaker(session, speaker, endedAt);
      speakers.push({
        userId: speaker.userId,
        username: speaker.username,
        duration: Math.max(0, endedAt - speaker.startedAt),
        audioUrl: chunks[0]?.audioUrl ?? null,
        chunks,
        rawPath: speaker.rawPath,
      });
    }

    const participants = [...session.participants.values()].map((participant) => ({
      ...participant,
      leftAt: participant.leftAt ?? endedAt,
    }));

    console.log(
      `[discord-adapter] finalize session=${session.sessionId} speakersTracked=${session.speakers.size} participantSnapshot=${JSON.stringify(
        participants.map((participant) => ({
          userId: participant.userId,
          username: participant.username,
          didSpeak: participant.didSpeak,
          joinedAt: participant.joinedAt,
          leftAt: participant.leftAt,
        })),
      )}`,
    );

    const metadata = this.buildWebhookPayload(session, speakers, participants, endedAt);
    const transcriptArtifacts = await this.buildTranscriptArtifacts(session, metadata);
    let summary: SessionSummary | null = null;
    try {
      summary = await this.buildSummaryArtifacts(session, metadata, transcriptArtifacts);
    } catch (error) {
      console.warn(
        `[discord-adapter] summary generation skipped session=${session.sessionId}: ${this.describeError(error)}`,
      );
    }
    let memoryIngest: { transcriptPath: string | null; summaryPath: string | null } = {
      transcriptPath: null,
      summaryPath: null,
    };
    try {
      memoryIngest = await this.ingestArtifactsToPrismMemory(metadata, transcriptArtifacts, summary);
    } catch (error) {
      console.warn(
        `[discord-adapter] prism memory ingest skipped session=${session.sessionId}: ${this.describeError(error)}`,
      );
    }
    metadata.artifacts = {
      transcriptJsonPath: transcriptArtifacts?.transcriptJsonPath,
      transcriptMarkdownPath: transcriptArtifacts?.transcriptMarkdownPath,
      summaryJsonPath: summary?.summaryJsonPath,
      summaryMarkdownPath: summary?.summaryMarkdownPath,
      prismMemoryTranscriptPath: memoryIngest.transcriptPath ?? undefined,
      prismMemorySummaryPath: memoryIngest.summaryPath ?? undefined,
    };
    console.log(
      `[discord-adapter] finalized session=${session.sessionId} speakerArtifacts=${JSON.stringify(
        metadata.speakers.map((speaker) => ({
          userId: speaker.userId,
          username: speaker.username,
          chunkCount: speaker.chunks.length,
          rawPath: speaker.rawPath,
        })),
      )} artifacts=${JSON.stringify(metadata.artifacts ?? {})}`,
    );
    await fs.writeFile(path.join(session.rootDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await this.sendWebhook(metadata);

    if (connectionState) {
      connectionState.connection.destroy();
      this.connections.delete(session.guildId);
    }
    return metadata;
  }

  async rollcall(interaction: ChatInputCommandInteraction): Promise<string> {
    const active = interaction.guildId ? this.sessionsByGuild.get(interaction.guildId) : null;
    if (active) {
      const lines = [...active.participants.values()]
        .map((participant) => `- ${participant.username}${participant.didSpeak ? " (spoke)" : ""}`)
        .sort((left, right) => left.localeCompare(right));
      return [
        `Recording session: \`${active.sessionId}\``,
        `Voice channel: **${active.channelName}**`,
        `Participants: ${lines.length}`,
        lines.length > 0 ? lines.join("\n") : "- none",
      ].join("\n");
    }

    const { channel } = await this.resolveMemberVoiceChannel(interaction);
    const members = [...channel.members.values()]
      .filter((member) => !member.user.bot)
      .map((member) => `- ${member.displayName}`)
      .sort((left, right) => left.localeCompare(right));
    return [
      `Voice channel: **${channel.name}**`,
      `Participants: ${members.length}`,
      members.length > 0 ? members.join("\n") : "- none",
    ].join("\n");
  }

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const session = this.sessionsByGuild.get(newState.guild.id) ?? this.sessionsByGuild.get(oldState.guild.id);
    if (!session) {
      return;
    }
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) {
      return;
    }

    if (newState.channelId === session.channelId) {
      console.log(
        `[discord-adapter] voice state update session=${session.sessionId} user=${member.user.id} joinedOrPresent channel=${session.channelId}`,
      );
      this.ensureParticipant(session, member);
      return;
    }

    if (oldState.channelId === session.channelId && newState.channelId !== session.channelId) {
      console.log(
        `[discord-adapter] voice state update session=${session.sessionId} user=${member.user.id} left channel=${session.channelId} next=${newState.channelId ?? "none"}`,
      );
      const participant = session.participants.get(member.user.id);
      if (participant) {
        participant.leftAt = Date.now();
      }
    }
  }

  private async transcodeSpeaker(session: RecordingSession, speaker: SpeakerStream, endedAt: number): Promise<VoiceChunkMetadata[]> {
    const stat = await fs.stat(speaker.rawPath).catch(() => null);
    if (!stat || stat.size < 1024) {
      console.log(
        `[discord-adapter] skipping transcode session=${session.sessionId} user=${speaker.userId} path=${speaker.rawPath} size=${stat?.size ?? 0}`,
      );
      return [];
    }
    const outputPattern = path.join(session.flacDir, `${speaker.userId}-${sanitizeFileSegment(speaker.username)}-chunk_%03d.flac`);
    await this.runFfmpeg(speaker.rawPath, outputPattern);
    const files = (await fs.readdir(session.flacDir))
      .filter((name) => name.startsWith(`${speaker.userId}-${sanitizeFileSegment(speaker.username)}-chunk_`) && name.endsWith(".flac"))
      .sort();
    const totalDuration = Math.max(0, endedAt - speaker.startedAt);
    const base = this.publicBaseUrl();
    const chunks: VoiceChunkMetadata[] = [];
    for (const [index, fileName] of files.entries()) {
      const filePath = path.join(session.flacDir, fileName);
      const fileStat = await fs.stat(filePath);
      const startMs = Math.min(totalDuration, index * this.ffmpegSegmentSeconds * 1000);
      const endMs = Math.min(totalDuration, (index + 1) * this.ffmpegSegmentSeconds * 1000);
      chunks.push({
        audioUrl: base ? `${base}/recordings/${session.sessionId}/${encodeURIComponent(fileName)}` : null,
        index,
        startMs,
        endMs,
        byteStart: 0,
        byteEnd: fileStat.size,
        fileName,
        contentType: "audio/flac",
      });
    }
    return chunks;
  }

  private runFfmpeg(inputPath: string, outputPattern: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        inputPath,
        "-f",
        "segment",
        "-segment_time",
        String(this.ffmpegSegmentSeconds),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "flac",
        outputPattern,
      ];
      const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-400)}`));
      });
      ffmpeg.on("error", reject);
    });
  }

  private buildWebhookPayload(
    session: RecordingSession,
    speakers: SpeakerMetadata[],
    participants: ParticipantPresence[],
    endedAt: number,
  ): RecordingSessionMetadata {
    const attendeeIds = [...new Set(participants.map((participant) => participant.userId))];
    return {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt,
      channelId: session.channelId,
      guildId: session.guildId,
      speakers,
      participants,
      metadata: {
        meeting: {
          name: session.channelName,
          platform: "discord",
          channel_id: session.channelId,
          attendee_ids: attendeeIds,
          attendee_count: attendeeIds.length,
          location: `Discord #${session.channelName}`,
          timezone: process.env.MEETING_TIMEZONE || process.env.TZ || "UTC",
        },
        sys: {
          event_name: "meeting.held",
          time_window: {
            start: new Date(session.startedAt).toISOString(),
            end: new Date(endedAt).toISOString(),
          },
        },
      },
      source: {
        service: "source-adapter",
        transport: "discord",
        storage: "local-volume",
        recordingBaseUrl: this.publicBaseUrl(),
        authHeader: "X-Adapter-Token",
      },
    };
  }

  private async buildTranscriptArtifacts(
    session: RecordingSession,
    metadata: RecordingSessionMetadata,
  ): Promise<SessionTranscriptArtifacts | null> {
    const chatMessages = await this.fetchVoiceChannelChatSegments(session, metadata.endedAt);
    const speakerTranscripts: SpeakerTranscript[] = [];

    if (this.voiceTranscriptionApiKey()) {
      for (const speaker of metadata.speakers) {
        const segments: TranscriptionSegment[] = [];
        for (const chunk of speaker.chunks) {
          const chunkPath = path.join(session.flacDir, chunk.fileName);
          const result = await this.transcribeChunk(chunkPath);
          const offsetSeconds = (chunk.startMs ?? 0) / 1000;
          const chunkSegments = (result.timestamps?.segment ?? [])
            .map((segment) => ({
              text: String(segment.text ?? "").trim(),
              start: Number(segment.start ?? 0) + offsetSeconds,
              end: Number(segment.end ?? 0) + offsetSeconds,
              speaker: speaker.username,
              speakerId: speaker.userId,
              chunkIndex: chunk.index,
              source: "voice" as const,
            }))
            .filter((segment) => segment.text);
          if (chunkSegments.length === 0) {
            const fallbackText = String(result.text ?? "").trim();
            if (fallbackText) {
              chunkSegments.push({
                text: fallbackText,
                start: offsetSeconds,
                end: offsetSeconds + Math.max(1, Number(result.duration ?? 0)),
                speaker: speaker.username,
                speakerId: speaker.userId,
                chunkIndex: chunk.index,
                source: "voice",
              });
            }
          }
          segments.push(...chunkSegments);
        }
        segments.sort((left, right) => left.start - right.start);
        speakerTranscripts.push({
          userId: speaker.userId,
          username: speaker.username,
          text: segments.map((segment) => segment.text).join(" ").trim(),
          segments,
        });
      }
    } else if (metadata.speakers.length > 0) {
      console.warn(`[discord-adapter] voice transcription skipped session=${session.sessionId}: VOICE_TRANSCRIPTION_API_KEY is not configured`);
    }

    if (speakerTranscripts.length === 0 && chatMessages.length === 0) {
      return null;
    }

    const mergedSegments = [...speakerTranscripts.flatMap((speaker) => speaker.segments), ...chatMessages].sort((left, right) =>
      left.start === right.start ? left.speaker.localeCompare(right.speaker) : left.start - right.start,
    );
    const mergedTranscript = mergedSegments
      .map((segment) => {
        const sourceLabel = segment.source === "chat" ? " chat" : "";
        const suffix = segment.jumpUrl ? ` (${segment.jumpUrl})` : "";
        return `[${this.formatTimeSec(segment.start)}] [${segment.speaker}${sourceLabel}]: ${segment.text}${suffix}`;
      })
      .join("\n");

    const transcriptPayload = {
      sessionId: metadata.sessionId,
      guildId: metadata.guildId,
      channelId: metadata.channelId,
      startedAt: metadata.startedAt,
      endedAt: metadata.endedAt,
      speakerTranscripts,
      chatMessages,
      mergedSegments,
      mergedTranscript,
    };

    const transcriptJsonPath = path.join(session.transcriptDir, "transcript.json");
    const transcriptMarkdownPath = path.join(session.transcriptDir, "transcript.md");
    await fs.writeFile(transcriptJsonPath, `${JSON.stringify(transcriptPayload, null, 2)}\n`, "utf8");
    await fs.writeFile(
      transcriptMarkdownPath,
      [
        `# ${metadata.metadata.meeting.name || "Discord Meeting Transcript"}`,
        "",
        `- Session: \`${metadata.sessionId}\``,
        `- Guild: \`${metadata.guildId}\``,
        `- Channel: \`${metadata.channelId}\``,
        `- Started: ${new Date(metadata.startedAt).toISOString()}`,
        `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
        "",
        mergedTranscript || "_No transcript content generated._",
        "",
      ].join("\n"),
      "utf8",
    );

    return {
      speakerTranscripts,
      chatMessages,
      mergedSegments,
      mergedTranscript,
      transcriptJsonPath,
      transcriptMarkdownPath,
    };
  }

  private async fetchVoiceChannelChatSegments(session: RecordingSession, endedAt: number): Promise<TranscriptionSegment[]> {
    try {
      const messages = await this.fetchDiscordMessages(session.channelId, new Date(session.startedAt), new Date(endedAt), this.voiceChatMaxMessages);
      const segments: TranscriptionSegment[] = [];
      for (const message of messages) {
        const timestampRaw = typeof message.timestamp === "string" ? message.timestamp : null;
        if (!timestampRaw) {
          continue;
        }
        const timestamp = parseIsoDate(timestampRaw);
        const author = message.author && typeof message.author === "object" && !Array.isArray(message.author) ? (message.author as JsonObject) : {};
        if (Boolean(author.bot) && this.ignoreVoiceChatBotMessages()) {
          continue;
        }
        const text = this.renderDiscordChatMessage(message);
        if (!text) {
          continue;
        }
        const messageId = typeof message.id === "string" ? message.id : undefined;
        segments.push({
          text,
          start: Math.max(0, (timestamp.getTime() - session.startedAt) / 1000),
          end: Math.max(0, (timestamp.getTime() - session.startedAt) / 1000),
          speaker: this.discordAuthorName(author),
          speakerId: typeof author.id === "string" ? author.id : "unknown",
          source: "chat",
          messageId,
          jumpUrl: messageId ? `https://discord.com/channels/${session.guildId}/${session.channelId}/${messageId}` : undefined,
          timestamp: timestamp.toISOString(),
        });
      }
      console.log(`[discord-adapter] voice chat transcript messages session=${session.sessionId} count=${segments.length}`);
      return segments.sort((left, right) => left.start - right.start);
    } catch (error) {
      console.warn(`[discord-adapter] voice chat transcript skipped session=${session.sessionId}: ${this.describeError(error)}`);
      return [];
    }
  }

  private async fetchDiscordMessages(channelId: string, since: Date, until: Date, maxMessages: number): Promise<JsonObject[]> {
    const collected: JsonObject[] = [];
    let before: string | undefined;
    while (collected.length < maxMessages) {
      const batch = await this.discordApiRequest<JsonObject[]>(`/channels/${channelId}/messages`, {
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
        collected.push(candidate);
        if (collected.length >= maxMessages) {
          break;
        }
      }
      const oldest = batch.at(-1);
      before = oldest && typeof oldest.id === "string" ? oldest.id : undefined;
      if (stop || !before) {
        break;
      }
    }
    return collected.reverse();
  }

  private async discordApiRequest<T>(pathname: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const token = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
    if (!token) {
      throw new Error("DISCORD_BOT_TOKEN is required for voice chat transcript capture");
    }
    const url = new URL(`https://discord.com/api/v10${pathname}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && `${value}` !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "prism-source-adapter/0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`Discord API failed: ${response.status} ${pathname} ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  private renderDiscordChatMessage(message: JsonObject): string {
    const parts: string[] = [];
    const content = String(message.content ?? "").trim();
    if (content) {
      parts.push(content);
    }
    const attachments = Array.isArray(message.attachments) ? message.attachments.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)) : [];
    for (const attachment of attachments) {
      const filename = typeof attachment.filename === "string" ? attachment.filename : "attachment";
      const url = typeof attachment.url === "string" ? attachment.url : null;
      parts.push(url ? `[attachment: ${filename}] ${url}` : `[attachment: ${filename}]`);
    }
    const embeds = Array.isArray(message.embeds) ? message.embeds.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)) : [];
    for (const embed of embeds) {
      const embedParts = [embed.title, embed.description, embed.url]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim());
      if (embedParts.length > 0) {
        parts.push(`[embed] ${embedParts.join(" — ")}`);
      }
    }
    return parts.join("\n").trim();
  }

  private discordAuthorName(author: JsonObject): string {
    for (const key of ["global_name", "display_name", "username", "id"]) {
      const value = author[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "discord-user";
  }

  private ignoreVoiceChatBotMessages(): boolean {
    const raw = (process.env.VOICE_CHAT_IGNORE_BOT_MESSAGES ?? "true").trim().toLowerCase();
    return !["0", "false", "no", "off"].includes(raw);
  }

  private async buildSummaryArtifacts(
    session: RecordingSession,
    metadata: RecordingSessionMetadata,
    transcriptArtifacts: SessionTranscriptArtifacts | null,
  ): Promise<SessionSummary | null> {
    if (!transcriptArtifacts?.mergedTranscript.trim()) {
      return null;
    }

    const prompt = [
      "You are a meeting synthesis assistant for Prism.",
      "Return valid JSON only. Do not include markdown fences or extra commentary.",
      "Summarize the meeting transcript and extract action items, notable quotes, and tags.",
      "The transcript may interleave spoken voice segments and Discord voice-channel chat messages marked with a `chat` source label.",
      "Use exactly this JSON schema:",
      "{",
      '  "title": "descriptive title",',
      '  "tldr": "short summary",',
      '  "summary": "detailed summary",',
      '  "actionItems": [{"name":"string","description":"string","assignedTo":"string or null","dueDate":"YYYY-MM-DD or null","params":{}}],',
      '  "notableQuotes": [{"author":"string","quote":"string","paraphrase":"string"}],',
      '  "tags": ["tag-1","tag-2","tag-3"]',
      "}",
      "",
      "Meeting metadata:",
      `- Name: ${metadata.metadata.meeting.name || "Discord meeting"}`,
      `- Channel: ${metadata.metadata.meeting.location || metadata.channelId}`,
      `- Started: ${new Date(metadata.startedAt).toISOString()}`,
      `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
      `- Participants: ${metadata.participants.map((participant) => participant.username).join(", ") || "unknown"}`,
      "",
      "Transcript:",
      transcriptArtifacts.mergedTranscript.slice(0, 120_000),
    ].join("\n");

    const parsed = this.safeJsonParse(await this.codexRuntimeRequest(prompt, metadata.sessionId));
    const summary: SessionSummary = {
      title: typeof parsed?.title === "string" && parsed.title.trim() ? parsed.title.trim() : metadata.metadata.meeting.name || "Meeting Summary",
      tldr: typeof parsed?.tldr === "string" ? parsed.tldr.trim() : "",
      summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
      actionItems: Array.isArray(parsed?.actionItems) ? parsed.actionItems : [],
      notableQuotes: Array.isArray(parsed?.notableQuotes) ? parsed.notableQuotes : [],
      tags: Array.isArray(parsed?.tags) ? parsed.tags.filter((item: unknown): item is string => typeof item === "string") : [],
      raw: parsed,
      summaryJsonPath: path.join(session.transcriptDir, "summary.json"),
      summaryMarkdownPath: path.join(session.transcriptDir, "summary.md"),
    };
    await fs.writeFile(summary.summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await fs.writeFile(summary.summaryMarkdownPath, this.renderSummaryMarkdown(metadata, summary), "utf8");
    return summary;
  }

  private codexRuntimeBaseUrl(): string {
    const direct = (process.env.CODEX_RUNTIME_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (direct) {
      return direct;
    }
    const railway = (process.env.RAILWAY_SERVICE_CODEX_RUNTIME_URL ?? "").trim();
    if (railway) {
      return `https://${railway.replace(/\/+$/, "")}`;
    }
    throw new Error("CODEX_RUNTIME_BASE_URL is required for voice summaries");
  }

  private codexRuntimeTimeoutMs(): number {
    const value = Number.parseInt(process.env.CODEX_RUNTIME_REQUEST_TIMEOUT_SECONDS ?? "660", 10);
    if (Number.isFinite(value) && value > 0) {
      return value * 1000;
    }
    return 660_000;
  }

  private async codexRuntimeRequest(prompt: string, sessionId: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.codexRuntimeTimeoutMs());
    try {
      const response = await fetch(`${this.codexRuntimeBaseUrl()}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          sessionId: `voice-summary-${sessionId}`,
          codexThreadId: null,
          recentHistory: [],
          metadata: {
            purpose: "voice_meeting_summary",
            source: "discord-voice",
            recordingSessionId: sessionId,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`CODEX_RUNTIME_REQUEST_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
      }
      const payload = (await response.json()) as { responseText?: string; output_text?: string };
      const responseText = typeof payload.responseText === "string" ? payload.responseText : typeof payload.output_text === "string" ? payload.output_text : "";
      if (!responseText.trim()) {
        throw new Error("CODEX_RUNTIME_EMPTY_RESPONSE");
      }
      return responseText.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  private voiceTranscriptionApiKey(): string {
    return (process.env.VOICE_TRANSCRIPTION_API_KEY ?? "").trim();
  }

  private voiceTranscriptionApiUrl(): string {
    const url = process.env.VOICE_TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "") || "";
    if (!url) {
      throw new Error("VOICE_TRANSCRIPTION_BASE_URL is required when voice transcription is enabled");
    }
    return url;
  }

  private async transcribeChunk(filePath: string): Promise<VoiceTranscriptionResponse> {
    const model = (process.env.VOICE_TRANSCRIPTION_MODEL ?? "").trim();
    const responseFormat = (process.env.VOICE_TRANSCRIPTION_RESPONSE_FORMAT ?? "").trim() || "json";
    const timestamps = (process.env.VOICE_TRANSCRIPTION_TIMESTAMPS ?? "true").trim() || "true";
    const form = new FormData();
    const fileBuffer = await fs.readFile(filePath);
    form.append("file", new Blob([fileBuffer], { type: "audio/flac" }), path.basename(filePath));
    if (model) {
      form.append("model", model);
    }
    form.append("response_format", responseFormat);
    form.append("timestamps", timestamps);
    const language = (process.env.VOICE_TRANSCRIPTION_LANGUAGE ?? "").trim();
    if (language) {
      form.append("language", language);
    }

    const response = await fetch(this.voiceTranscriptionApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.voiceTranscriptionApiKey()}`,
      },
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Voice transcription failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
    return (await response.json()) as VoiceTranscriptionResponse;
  }

  private formatTimeSec(value: number): string {
    const seconds = Math.max(0, Math.floor(value));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const remainder = String(seconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${remainder}`;
  }

  private safeJsonParse(input: string): any {
    const cleaned = input
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error("Failed to parse summary JSON response");
    }
  }

  private prismApiBaseUrl(): string {
    const baseUrl = (process.env.PRISM_API_BASE ?? "").trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("PRISM_API_BASE is required for Prism memory ingest");
    }
    return baseUrl;
  }

  private prismArtifactReference(artifactPath?: string): { id: string; url: string } | null {
    if (!artifactPath) {
      return null;
    }
    const filename = path.basename(artifactPath);
    const artifactId = filename.replace(/\.json$/i, "");
    if (!artifactId || artifactId === filename) {
      return null;
    }
    try {
      const baseUrl = this.prismApiBaseUrl();
      return {
        id: artifactId,
        url: `${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`,
      };
    } catch {
      return null;
    }
  }

  private prismApiKey(): string {
    const apiKey = (process.env.PRISM_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("PRISM_API_KEY is required for Prism memory ingest");
    }
    return apiKey;
  }

  private async prismMemoryInboxWrite(payload: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${this.prismApiBaseUrl()}/memory/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prism-Api-Key": this.prismApiKey(),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`PRISM_MEMORY_INBOX_FAILED:${response.status}:${(await response.text()).slice(0, 300)}`);
    }
    const result = (await response.json()) as { path?: string };
    if (!result.path || typeof result.path !== "string") {
      throw new Error("PRISM_MEMORY_INBOX_MISSING_PATH");
    }
    return result.path;
  }

  private async ingestArtifactsToPrismMemory(
    metadata: RecordingSessionMetadata,
    transcriptArtifacts: SessionTranscriptArtifacts | null,
    summary: SessionSummary | null,
  ): Promise<{ transcriptPath: string | null; summaryPath: string | null }> {
    const prismApiBase = (process.env.PRISM_API_BASE ?? "").trim();
    const prismApiKey = (process.env.PRISM_API_KEY ?? "").trim();
    if (!prismApiBase || !prismApiKey) {
      return { transcriptPath: null, summaryPath: null };
    }

    const participants = metadata.participants.map((participant) => participant.username).filter(Boolean);
    const basePayload = {
      source: "discord-voice",
      bucket_hint: "meetings",
      author: "Prism Voice Recorder",
      participants,
      participant_count: participants.length,
      url: metadata.source.recordingBaseUrl ? `${metadata.source.recordingBaseUrl}/recordings/${metadata.sessionId}` : undefined,
    };

    let transcriptPath: string | null = null;
    let summaryPath: string | null = null;

    if (transcriptArtifacts?.mergedTranscript.trim()) {
      transcriptPath = await this.prismMemoryInboxWrite({
        ...basePayload,
        type: "meeting_transcript",
        ts: new Date(metadata.endedAt).toISOString(),
        content: [
          `# ${metadata.metadata.meeting.name || "Discord Meeting Transcript"}`,
          "",
          `- Session: ${metadata.sessionId}`,
          `- Channel: ${metadata.metadata.meeting.location || metadata.channelId}`,
          `- Started: ${new Date(metadata.startedAt).toISOString()}`,
          `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
          `- Participants: ${participants.join(", ") || "unknown"}`,
          "",
          transcriptArtifacts.mergedTranscript,
        ].join("\n"),
      });
    }

    if (summary) {
      summaryPath = await this.prismMemoryInboxWrite({
        ...basePayload,
        type: "meeting_summary",
        ts: new Date(metadata.endedAt).toISOString(),
        content: this.renderSummaryMarkdown(metadata, summary),
      });
    }

    return { transcriptPath, summaryPath };
  }

  private renderSummaryMarkdown(metadata: RecordingSessionMetadata, summary: SessionSummary): string {
    const actionLines = summary.actionItems.length > 0
      ? summary.actionItems.map((item) => `- ${item.name}: ${item.description}${item.assignedTo ? ` (owner: ${item.assignedTo})` : ""}${item.dueDate ? ` (due: ${item.dueDate})` : ""}`).join("\n")
      : "- None captured.";
    const quoteLines = summary.notableQuotes.length > 0
      ? summary.notableQuotes.map((item) => `- ${item.author}: "${item.quote}"${item.paraphrase ? `\n  - ${item.paraphrase}` : ""}`).join("\n")
      : "- None captured.";

    return [
      `# ${summary.title || metadata.metadata.meeting.name || "Meeting Summary"}`,
      "",
      `- Session: ${metadata.sessionId}`,
      `- Channel: ${metadata.metadata.meeting.location || metadata.channelId}`,
      `- Started: ${new Date(metadata.startedAt).toISOString()}`,
      `- Ended: ${new Date(metadata.endedAt).toISOString()}`,
      `- Participants: ${metadata.participants.map((participant) => participant.username).join(", ") || "unknown"}`,
      summary.tags.length > 0 ? `- Tags: ${summary.tags.join(", ")}` : "- Tags: none",
      "",
      "## TL;DR",
      "",
      summary.tldr || "No short summary generated.",
      "",
      "## Summary",
      "",
      summary.summary || "No detailed summary generated.",
      "",
      "## Action Items",
      "",
      actionLines,
      "",
      "## Notable Quotes",
      "",
      quoteLines,
      "",
    ].join("\n");
  }

  private async sendWebhook(metadata: RecordingSessionMetadata): Promise<void> {
    const url = (process.env.N8N_WEBHOOK_URL ?? "").trim();
    if (!url) {
      return;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });
    if (!response.ok) {
      throw new Error(`N8N webhook failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
  }

  async resolveRecordingDownload(sessionId: string, fileName: string): Promise<{ filePath: string; contentType: string } | null> {
    const safeName = path.basename(fileName);
    const filePath = path.join(this.recordingsRoot, sessionId, "flac", safeName);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return null;
    }
    return { filePath, contentType: "audio/flac" };
  }
}
