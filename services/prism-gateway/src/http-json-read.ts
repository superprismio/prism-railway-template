import { lookup } from "node:dns/promises";
import https from "node:https";
import { isForbiddenIpAddress } from "./network.js";
import type { HttpJsonReadDriverConfig } from "./types.js";

export class GatewayDriverError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
  }
}

export type HttpJsonReadResult = {
  result: unknown;
  status: number;
  responseBytes: number;
};

type ResolvedAddress = { address: string; family: number };

type DriverDependencies = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (
    url: URL,
    headers: Record<string, string>,
    config: HttpJsonReadDriverConfig,
    address: ResolvedAddress,
  ) => Promise<HttpJsonReadResult>;
};

function queryValue(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value) && value.every((entry) => (
    typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
  ))) {
    return value.map(String);
  }
  throw new GatewayDriverError("CAPABILITY_INPUT_QUERY_VALUE_INVALID", false);
}

function buildRequestUrl(config: HttpJsonReadDriverConfig, input: Record<string, unknown>) {
  const unknownKeys = Object.keys(input).filter((key) => !config.allowedQueryParams.includes(key));
  if (unknownKeys.length > 0) throw new GatewayDriverError("CAPABILITY_INPUT_KEY_NOT_ALLOWED", false);
  const url = new URL(config.pathTemplate, `${config.baseUrl}/`);
  if (url.origin !== config.baseUrl) throw new GatewayDriverError("CAPABILITY_TARGET_ORIGIN_MISMATCH", false);
  for (const [key, value] of Object.entries(input)) {
    for (const item of queryValue(value)) url.searchParams.append(key, item);
  }
  return url;
}

function buildHeaders(config: HttpJsonReadDriverConfig, credentials: Record<string, string>) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "prism-gateway/0.1",
  };
  if (config.auth.type === "none") return headers;
  const value = credentials[config.auth.secretName];
  if (!value) throw new GatewayDriverError("CAPABILITY_CONNECTION_SECRET_MISSING", false);
  if (config.auth.type === "bearer") headers.authorization = `Bearer ${value}`;
  else headers[config.auth.headerName] = value;
  return headers;
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

function performPinnedJsonRequest(
  url: URL,
  headers: Record<string, string>,
  config: HttpJsonReadDriverConfig,
  address: ResolvedAddress,
) {
  return new Promise<HttpJsonReadResult>((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new GatewayDriverError("CAPABILITY_REDIRECT_FORBIDDEN", false));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new GatewayDriverError("CAPABILITY_DOWNSTREAM_HTTP_ERROR", status >= 500 || status === 429));
        return;
      }
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      if (!contentType.includes("application/json") && !contentType.includes("+json")) {
        response.resume();
        reject(new GatewayDriverError("CAPABILITY_RESPONSE_NOT_JSON", false));
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
      response.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ result: JSON.parse(body), status, responseBytes: total });
        } catch {
          reject(new GatewayDriverError("CAPABILITY_RESPONSE_JSON_INVALID", false));
        }
      });
    });
    request.on("error", (error) => {
      if (error instanceof GatewayDriverError) reject(error);
      else if (error.name === "AbortError" || error.name === "TimeoutError") {
        reject(new GatewayDriverError("CAPABILITY_DOWNSTREAM_TIMEOUT", true));
      } else reject(new GatewayDriverError("CAPABILITY_DOWNSTREAM_REQUEST_FAILED", true));
    });
    request.end();
  });
}

export async function executeHttpJsonRead(
  config: HttpJsonReadDriverConfig,
  credentials: Record<string, string>,
  input: Record<string, unknown>,
  dependencies: DriverDependencies = {},
) {
  const url = buildRequestUrl(config, input);
  const headers = buildHeaders(config, credentials);
  const addresses = await (dependencies.resolve || resolvePublicAddresses)(url.hostname);
  if (addresses.length === 0 || addresses.some((entry) => isForbiddenIpAddress(entry.address))) {
    throw new GatewayDriverError("CAPABILITY_DNS_PRIVATE_ADDRESS_FORBIDDEN", false);
  }
  return (dependencies.request || performPinnedJsonRequest)(url, headers, config, addresses[0]);
}
