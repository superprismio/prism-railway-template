import assert from "node:assert/strict";
import test from "node:test";
import { meetingMemoryMetadata } from "./meeting-memory-metadata.js";

test("transcript and summary share identity and preserve attendance independently of display names", () => {
  const metadata = meetingMemoryMetadata({
    sessionId: "session-1", guildId: "guild-1", channelId: "channel-1",
    startedAt: 1000, endedAt: 2000,
    participants: [{ userId: "user-1", username: "Alex", joinedAt: 1000, didSpeak: false }],
    metadata: {
      meeting: { platform: "discord", channel_id: "channel-1", attendee_ids: ["user-1"], attendee_count: 1 },
      sys: { event_name: "meeting.held", time_window: { start: "", end: "" } },
    },
  });
  const transcript = { ...metadata, source_type: "meeting_transcript" };
  const summary = { ...metadata, source_type: "meeting_summary", action_items: [] };
  assert.equal(transcript.session_id, summary.session_id);
  assert.equal(transcript.guild_id, "guild-1");
  assert.equal(metadata.started_at, "1970-01-01T00:00:01.000Z");
  assert.deepEqual(metadata.participant_presence, [{ id: "user-1", display_name: "Alex",
    did_speak: false, joined_at: "1970-01-01T00:00:01.000Z", left_at: null }]);
});
