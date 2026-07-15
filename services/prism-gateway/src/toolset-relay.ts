import { lookup } from "node:dns/promises";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { createPinnedLookup, GatewayDriverError, type ResolvedAddress } from "./http-json-read.js";
import { isForbiddenIpAddress } from "./network.js";
import type { GatewayToolsetProfile } from "./types.js";
import { executeMcpJsonRpc } from "./mcp-tool-call.js";

const TOOLSET_DOWNSTREAM_TIMEOUT_MS = 60_000;

export type HttpToolsetRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  body?: unknown;
  multipart?: {
    fields?: Record<string, string>;
    file: {
      fieldName: string;
      filename: string;
      contentType: string;
      dataBase64: string;
    };
  };
};
export type McpToolsetRequest = {
  tool: string;
  arguments?: Record<string, unknown>;
};
export type ToolsetRequest = HttpToolsetRequest | McpToolsetRequest;

export type ToolsetRelayResult = {
  status: number;
  contentType: string;
  body: unknown;
  responseBytes: number;
};

function targetUrl(profile: GatewayToolsetProfile, request?: ToolsetRequest) {
  if (!request) return new URL(profile.discoveryUrl);
  if (!("path" in request)) throw new GatewayDriverError("TOOLSET_HTTP_REQUEST_INVALID", false);
  if (!request.path.startsWith("/") || request.path.startsWith("//") || request.path.includes("\\")) {
    throw new GatewayDriverError("TOOLSET_PATH_INVALID", false);
  }
  const origin = new URL(profile.discoveryUrl).origin;
  const url = new URL(request.path, `${origin}/`);
  if (url.origin !== origin) throw new GatewayDriverError("TOOLSET_TARGET_ORIGIN_MISMATCH", false);
  for (const [key, rawValue] of Object.entries(request.query ?? {})) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (!["string", "number", "boolean"].includes(typeof value)) {
        throw new GatewayDriverError("TOOLSET_QUERY_INVALID", false);
      }
      url.searchParams.append(key, String(value));
    }
  }
  return url;
}

function requestHeaders(
  profile: GatewayToolsetProfile,
  credentials: Record<string, string>,
  body: Buffer | null,
  contentType: string | null,
  payloadToken?: string,
) {
  const headers: Record<string, string> = { accept: "application/json, text/plain;q=0.9", "user-agent": "prism-gateway/0.1" };
  if (body !== null) {
    headers["content-type"] = contentType || "application/octet-stream";
    headers["content-length"] = String(body.length);
  }
  if (profile.auth.type === "payload-login") {
    if (!payloadToken) throw new GatewayDriverError("TOOLSET_PAYLOAD_TOKEN_MISSING", false);
    headers.authorization = `JWT ${payloadToken}`;
  } else if (profile.auth.type !== "none") {
    const secret = credentials[profile.auth.secretName];
    if (!secret) throw new GatewayDriverError("TOOLSET_CONNECTION_SECRET_MISSING", false);
    if (profile.auth.type === "bearer") headers.authorization = `Bearer ${secret}`;
    else headers[profile.auth.headerName] = secret;
  }
  return headers;
}

function multipartToken(value: string, code: string, maxLength: number) {
  if (!value || value.length > maxLength || /[\r\n"]/u.test(value)) {
    throw new GatewayDriverError(code, false);
  }
  return value;
}

export function encodeMultipartBody(multipart: NonNullable<HttpToolsetRequest["multipart"]>) {
  const boundary = `prism-${randomBytes(18).toString("hex")}`;
  const chunks: Buffer[] = [];
  const append = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  for (const [name, value] of Object.entries(multipart.fields ?? {})) {
    multipartToken(name, "TOOLSET_MULTIPART_FIELD_INVALID", 120);
    if (typeof value !== "string" || Buffer.byteLength(value) > 100_000) {
      throw new GatewayDriverError("TOOLSET_MULTIPART_FIELD_INVALID", false);
    }
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  const file = multipart.file;
  const fieldName = multipartToken(file?.fieldName, "TOOLSET_MULTIPART_FILE_INVALID", 120);
  const filename = multipartToken(file?.filename, "TOOLSET_MULTIPART_FILE_INVALID", 240);
  const contentType = multipartToken(file?.contentType, "TOOLSET_MULTIPART_FILE_INVALID", 120);
  if (typeof file?.dataBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.dataBase64)) {
    throw new GatewayDriverError("TOOLSET_MULTIPART_FILE_INVALID", false);
  }
  const fileBody = Buffer.from(file.dataBase64, "base64");
  if (!fileBody.length || fileBody.length > 10_000_000) {
    throw new GatewayDriverError("TOOLSET_MULTIPART_FILE_TOO_LARGE", false);
  }
  append(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  append(fileBody);
  append(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat(chunks);
  if (body.length > 11_000_000) throw new GatewayDriverError("TOOLSET_BODY_TOO_LARGE", false);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function publicAddresses(hostname: string) {
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new GatewayDriverError("TOOLSET_DNS_LOOKUP_FAILED", true);
  }
  if (!addresses.length || addresses.some((entry) => isForbiddenIpAddress(entry.address))) {
    throw new GatewayDriverError("TOOLSET_DNS_PRIVATE_ADDRESS_FORBIDDEN", false);
  }
  return addresses;
}

export async function executeToolsetRequest(
  profile: GatewayToolsetProfile,
  credentials: Record<string, string>,
  request?: ToolsetRequest,
): Promise<ToolsetRelayResult> {
  if (profile.protocol === "mcp") {
    const tool = request && "tool" in request && typeof request.tool === "string"
      ? request.tool.trim()
      : "";
    const rawArguments = request && "arguments" in request ? request.arguments : undefined;
    const args = rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)
      ? rawArguments as Record<string, unknown>
      : {};
    if (request && !tool) throw new GatewayDriverError("TOOLSET_MCP_TOOL_REQUIRED", false);
    const result = await executeMcpJsonRpc({
      endpoint: profile.discoveryUrl,
      auth: profile.auth,
      credentials,
      method: request ? "tools/call" : "tools/list",
      params: request ? { name: tool, arguments: args } : {},
    });
    return {
      status: result.status,
      contentType: "application/json",
      body: result.result,
      responseBytes: result.responseBytes,
    };
  }
  if (request && !("path" in request)) throw new GatewayDriverError("TOOLSET_HTTP_REQUEST_INVALID", false);
  const url = targetUrl(profile, request);
  const httpRequest = request as HttpToolsetRequest | undefined;
  const method = httpRequest?.method ?? "GET";
  if (httpRequest?.body !== undefined && httpRequest.multipart !== undefined) {
    throw new GatewayDriverError("TOOLSET_BODY_AMBIGUOUS", false);
  }
  const encoded = httpRequest?.multipart
    ? encodeMultipartBody(httpRequest.multipart)
    : httpRequest && httpRequest.body !== undefined
      ? { body: Buffer.from(JSON.stringify(httpRequest.body)), contentType: "application/json" }
      : { body: null, contentType: null };
  const { body, contentType } = encoded;
  if (body !== null && body.length > 11_000_000) throw new GatewayDriverError("TOOLSET_BODY_TOO_LARGE", false);
  let payloadToken: string | undefined;
  if (profile.auth.type === "payload-login") {
    const email = credentials[profile.auth.emailSecretName];
    const password = credentials[profile.auth.passwordSecretName];
    if (!email || !password) throw new GatewayDriverError("TOOLSET_CONNECTION_SECRET_MISSING", false);
    const login = await executeToolsetRequest(
      { ...profile, auth: { type: "none" } },
      {},
      { method: "POST", path: profile.auth.loginPath, body: { email, password } },
    );
    const loginBody = login.body && typeof login.body === "object" && !Array.isArray(login.body)
      ? login.body as Record<string, unknown>
      : {};
    if (login.status < 200 || login.status >= 300 || typeof loginBody.token !== "string" || !loginBody.token) {
      throw new GatewayDriverError("TOOLSET_PAYLOAD_LOGIN_FAILED", login.status >= 500 || login.status === 429);
    }
    payloadToken = loginBody.token;
  }
  const headers = requestHeaders(profile, credentials, body, contentType, payloadToken);
  const addresses = await publicAddresses(url.hostname);

  return new Promise((resolve, reject) => {
    const downstream = https.request(url, {
      method,
      headers,
      signal: AbortSignal.timeout(TOOLSET_DOWNSTREAM_TIMEOUT_MS),
      lookup: createPinnedLookup(addresses[0]) as NonNullable<https.RequestOptions["lookup"]>,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new GatewayDriverError("TOOLSET_REDIRECT_FORBIDDEN", false));
        return;
      }
      const maxBytes = 5_000_000;
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) response.destroy(new GatewayDriverError("TOOLSET_RESPONSE_TOO_LARGE", false));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const contentType = String(response.headers["content-type"] || "application/octet-stream");
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = text;
        if (contentType.includes("json")) {
          try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
        }
        resolve({ status, contentType, body: parsed, responseBytes: total });
      });
    });
    downstream.on("error", (error) => {
      if (error instanceof GatewayDriverError) reject(error);
      else if (error.name === "AbortError" || error.name === "TimeoutError") reject(new GatewayDriverError("TOOLSET_DOWNSTREAM_TIMEOUT", true));
      else reject(new GatewayDriverError("TOOLSET_DOWNSTREAM_REQUEST_FAILED", true));
    });
    downstream.end(body ?? undefined);
  });
}
