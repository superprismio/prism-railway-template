import { isIP } from "node:net";

type RequestRecord = {
  id?: unknown;
  requestNumber?: unknown;
  title?: unknown;
  workflowRunStatus?: unknown;
  currentWorkflowStepKey?: unknown;
  workflowAttention?: unknown;
  completedAt?: unknown;
  closedAt?: unknown;
  origin?: unknown;
  requestUrl?: unknown;
};

export type DiscordRequestHandoff = {
  text: string;
  requestIds: string[];
  requestNumbers: number[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function publicRequestUrl(value: unknown, requestNumber: number): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || isIP(host)
      || host === "localhost" || host.endsWith(".internal") || host.endsWith(".local")
      || host.endsWith(".localhost")) return null;
    if (url.pathname !== `/admin/lab/requests/${requestNumber}` || url.search
      || url.hash !== "#selected-request-workspace") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** A sent reply remains delivered even if its session-history write fails. */
export async function sendAndRecordDiscordReply<T>(input: {
  send: () => Promise<T>;
  record: (sent: T) => Promise<void>;
  onRecordError: (error: unknown) => void;
}): Promise<T> {
  const sent = await input.send();
  try {
    await input.record(sent);
  } catch (error) {
    input.onRecordError(error);
  }
  return sent;
}

function requestState(request: RequestRecord): string {
  if (request.workflowRunStatus === "canceled" || request.workflowRunStatus === "cancelled") return "canceled";
  if (request.closedAt) return "closed";
  if (request.completedAt || request.workflowRunStatus === "completed") return "completed";
  const attention = record(request.workflowAttention);
  if (attention?.status === "blocked") return "blocked and needs attention";
  if (attention?.status === "needs_attention") return "needs attention";
  const step = typeof request.currentWorkflowStepKey === "string" ? request.currentWorkflowStepKey.trim() : "";
  return step ? `open at ${step}` : "open";
}

/** A bounded lookup for a request created by this exact Discord message. */
export async function recoverDiscordRequestHandoff(input: {
  sourceSessionId: string;
  sourceMessageId: string | null;
  channelId: string;
  threadId: string | null;
  lookup: (query: string, signal: AbortSignal) => Promise<unknown>;
}): Promise<DiscordRequestHandoff | null> {
  if (!input.sourceSessionId || !input.sourceMessageId) return null;
  const params = new URLSearchParams({
    sourceSessionId: input.sourceSessionId,
    sourceMessageId: input.sourceMessageId,
    platform: "discord",
    limit: "5",
  });
  let response: unknown;
  try {
    response = await input.lookup(`/agent/change-board/requests?${params}`, AbortSignal.timeout(5_000));
  } catch {
    return null;
  }
  const items = record(response)?.changeRequests;
  if (!Array.isArray(items)) return null;
  const matches = items.filter((item): item is RequestRecord => {
    const request = record(item);
    const origin = record(request?.origin);
    return typeof request?.requestNumber === "number" && Number.isSafeInteger(request.requestNumber)
      && request.requestNumber > 0
      && typeof request.id === "string"
      && origin?.sourceSessionId === input.sourceSessionId
      && origin?.sourceMessageId === input.sourceMessageId
      && origin?.platform === "discord"
      && origin?.targetId === input.channelId
      && origin?.threadId === input.threadId;
  }).slice(0, 5);
  if (!matches.length) return null;
  const lines = matches.map((request) => {
    const number = request.requestNumber as number;
    const requestUrl = publicRequestUrl(request.requestUrl, number);
    const link = requestUrl ? ` ${requestUrl}` : "";
    return `Request #${number}: ${requestState(request)}.${link}`;
  });
  return {
    text: [
      "The chat reply failed, but the request was created. Its current state is:",
      ...lines,
      ...(matches.length === 5 ? ["More requests may share this message; check the request inbox."] : []),
    ].join("\n"),
    requestIds: matches.map((request) => request.id as string),
    requestNumbers: matches.map((request) => request.requestNumber as number),
  };
}
