import type { RecordingSessionMetadata } from "./voice.js";

/** Shared identity for transcript and summary; content-specific fields are added by callers. */
export function meetingMemoryMetadata(metadata: Pick<RecordingSessionMetadata,
  "sessionId" | "guildId" | "channelId" | "startedAt" | "endedAt" | "participants" | "metadata">) {
  return {
    source_system: "discord-voice",
    source_id: metadata.sessionId,
    session_id: metadata.sessionId,
    guild_id: metadata.guildId,
    channel_id: metadata.channelId,
    channel_name: metadata.metadata.meeting.location || metadata.channelId,
    meeting_name: metadata.metadata.meeting.name || "Discord meeting",
    started_at: new Date(metadata.startedAt).toISOString(),
    ended_at: new Date(metadata.endedAt).toISOString(),
    participant_presence: metadata.participants.map((participant) => ({
      id: participant.userId,
      display_name: participant.username,
      did_speak: participant.didSpeak,
      joined_at: new Date(participant.joinedAt).toISOString(),
      left_at: participant.leftAt == null ? null : new Date(participant.leftAt).toISOString(),
    })),
  };
}
