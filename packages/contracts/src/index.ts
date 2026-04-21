export type HealthResponse = {
  ok: true;
  service: string;
  timestamp: string;
};

export type DiscordChatRequest = {
  prompt: string;
  guildId: string;
  channelId: string;
  threadId?: string | null;
  authorName?: string;
};
