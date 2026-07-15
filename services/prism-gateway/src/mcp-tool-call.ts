import { lookup } from "node:dns/promises";
import https from "node:https";
import {
  createPinnedLookup,
  GatewayDriverError,
  type ResolvedAddress,
} from "./http-json-read.js";
import { isForbiddenIpAddress } from "./network.js";
import type { McpToolCallDriverConfig } from "./types.js";

export type McpToolCallResult = {
  result: unknown;
  status: number;
  responseBytes: number;
  operation: string;
  toolName: string;
};

type DriverDependencies = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (
    url: URL,
    headers: Record<string, string>,
    config: McpToolCallDriverConfig,
    address: ResolvedAddress,
    body: string,
  ) => Promise<{ status: number; responseBytes: number; contentType: string; body: string }>;
};

function buildCall(config: McpToolCallDriverConfig, input: Record<string, unknown>) {
  const operation = typeof input.operation === "string" ? input.operation.trim() : "";
  const operationConfig = config.operations[operation];
  if (!operationConfig) throw new GatewayDriverError("CAPABILITY_INPUT_OPERATION_NOT_ALLOWED", false);
  const argumentEntries = Object.entries(input).filter(([key]) => key !== "operation");
  if (argumentEntries.some(([key]) => !operationConfig.allowedArguments.includes(key))) {
    throw new GatewayDriverError("CAPABILITY_INPUT_KEY_NOT_ALLOWED", false);
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: operationConfig.toolName,
      arguments: Object.fromEntries(argumentEntries),
    },
  });
  if (Buffer.byteLength(body) > 65_536) {
    throw new GatewayDriverError("CAPABILITY_INPUT_JSON_BODY_TOO_LARGE", false);
  }
  const url = new URL(config.pathTemplate, `${config.baseUrl}/`);
  if (url.origin !== config.baseUrl) throw new GatewayDriverError("CAPABILITY_TARGET_ORIGIN_MISMATCH", false);
  return { operation, toolName: operationConfig.toolName, url, body };
}

function buildHeaders(config: McpToolCallDriverConfig, credentials: Record<string, string>, body: string) {
  const credential = credentials[config.auth.secretName];
  if (!credential) throw new GatewayDriverError("CAPABILITY_CONNECTION_SECRET_MISSING", false);
  return {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${credential}`,
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    "user-agent": "prism-gateway/0.1",
  };
}

async function resolvePublicAddresses(hostname: string) {
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new GatewayDriverError("CAPABILITY_DNS_LOOKUP_FAILED", true);
  }
  if (addresses.length === 0) throw new GatewayDriverError("CAPABILITY_DNS_LOOKUP_EMPTY", true);
  if (addresses.some((entry) => isForbiddenIpAddress(entry.address))) {
    throw new GatewayDriverError("CAPABILITY_DNS_PRIVATE_ADDRESS_FORBIDDEN", false);
  }
  return addresses;
}

export function performPinnedRequest(
  url: URL,
  headers: Record<string, string>,
  config: McpToolCallDriverConfig,
  address: ResolvedAddress,
  body: string,
) {
  return new Promise<{ status: number; responseBytes: number; contentType: string; body: string }>((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
      lookup: createPinnedLookup(address) as NonNullable<https.RequestOptions["lookup"]>,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new GatewayDriverError("CAPABILITY_REDIRECT_FORBIDDEN", false));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new GatewayDriverError(`CAPABILITY_DOWNSTREAM_HTTP_${status || "ERROR"}`, status >= 500 || status === 429));
        return;
      }
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
        response.resume();
        reject(new GatewayDriverError("CAPABILITY_MCP_RESPONSE_TYPE_INVALID", false));
        return;
      }
      const declaredLength = Number.parseInt(String(response.headers["content-length"] || "0"), 10);
      if (declaredLength > config.maxResponseBytes) {
        response.destroy();
        reject(new GatewayDriverError("CAPABILITY_RESPONSE_TOO_LARGE", false));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > config.maxResponseBytes) {
          response.destroy(new GatewayDriverError("CAPABILITY_RESPONSE_TOO_LARGE", false));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({
        status,
        responseBytes: total,
        contentType,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", (error) => {
      if (error instanceof GatewayDriverError) reject(error);
      else if (error.name === "AbortError" || error.name === "TimeoutError") {
        reject(new GatewayDriverError("CAPABILITY_DOWNSTREAM_TIMEOUT", true));
      } else reject(new GatewayDriverError("CAPABILITY_DOWNSTREAM_REQUEST_FAILED", true));
    });
    request.end(body);
  });
}

function parseJsonRpcPayload(contentType: string, body: string) {
  let payloadText = body;
  if (contentType.includes("text/event-stream")) {
    const dataLines = body.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (dataLines.length === 0) throw new GatewayDriverError("CAPABILITY_MCP_RESPONSE_INVALID", false);
    payloadText = dataLines[dataLines.length - 1];
  }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payloadText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new GatewayDriverError("CAPABILITY_MCP_RESPONSE_INVALID", false);
  }
  if (payload.error) throw new GatewayDriverError("CAPABILITY_MCP_PROTOCOL_ERROR", false);
  return payload;
}

function parseJsonRpcResponse(contentType: string, body: string) {
  const payload = parseJsonRpcPayload(contentType, body);
  const result = payload.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new GatewayDriverError("CAPABILITY_MCP_RESULT_INVALID", false);
  }
  const resultRecord = result as Record<string, unknown>;
  if (resultRecord.isError === true) throw new GatewayDriverError("CAPABILITY_MCP_TOOL_ERROR", false);
  const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
  const textItem = content.find((entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry)
    && (entry as Record<string, unknown>).type === "text"
    && typeof (entry as Record<string, unknown>).text === "string"
  )) as Record<string, unknown> | undefined;
  if (!textItem) throw new GatewayDriverError("CAPABILITY_MCP_RESULT_INVALID", false);
  const text = String(textItem.text);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function executeMcpToolCall(
  config: McpToolCallDriverConfig,
  credentials: Record<string, string>,
  input: Record<string, unknown>,
  dependencies: DriverDependencies = {},
): Promise<McpToolCallResult> {
  const call = buildCall(config, input);
  const headers = buildHeaders(config, credentials, call.body);
  const addresses = await (dependencies.resolve || resolvePublicAddresses)(call.url.hostname);
  if (addresses.length === 0 || addresses.some((entry) => isForbiddenIpAddress(entry.address))) {
    throw new GatewayDriverError("CAPABILITY_DNS_PRIVATE_ADDRESS_FORBIDDEN", false);
  }
  const response = await (dependencies.request || performPinnedRequest)(
    call.url,
    headers,
    config,
    addresses[0],
    call.body,
  );
  return {
    result: parseJsonRpcResponse(response.contentType, response.body),
    status: response.status,
    responseBytes: response.responseBytes,
    operation: call.operation,
    toolName: call.toolName,
  };
}
