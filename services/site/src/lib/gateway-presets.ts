export const plausibleQueryInputSchema = {
  type: "object",
  required: ["site_id", "metrics", "date_range"],
  additionalProperties: false,
  properties: {
    site_id: { type: "string", minLength: 1 },
    metrics: { type: "array", minItems: 1, items: { type: "string" } },
    date_range: {
      oneOf: [
        { type: "string", minLength: 1 },
        {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: { type: "string" },
        },
      ],
    },
    dimensions: { type: "array", items: { type: "string" } },
    filters: { type: "array" },
    include: { type: "object" },
    pagination: { type: "object" },
  },
} as const;

export const plausibleGatewayPreset = {
  key: "plausible",
  provider: "plausible",
  defaultLabel: "Plausible Analytics",
  authType: "bearer",
  secretName: "apiKey",
  credentialEnvironmentName: "PLAUSIBLE_API_KEY",
  baseUrlEnvironmentName: "PLAUSIBLE_BASE_URL",
  capabilityKey: "plausible.stats.query",
} as const;

export const nextcrmContactReadInputSchema = {
  type: "object",
  required: ["operation"],
  additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["list", "get", "search"] },
    id: { type: "string", format: "uuid" },
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
  },
} as const;

export const nextcrmGatewayPreset = {
  key: "nextcrm-contact-read",
  provider: "nextcrm",
  defaultLabel: "NextCRM",
  authType: "bearer",
  secretName: "apiToken",
  credentialEnvironmentName: "NEXTCRM_API_TOKEN",
  baseUrlEnvironmentName: "NEXTCRM_BASE_URL",
  capabilityKey: "crm.contact.read",
} as const;

export function plausibleGatewayCapability(input: {
  connectionId: string;
  origin: string;
  enabled?: boolean;
}) {
  return {
    key: plausibleGatewayPreset.capabilityKey,
    driverKey: "http-json.read",
    connectionId: input.connectionId,
    provider: plausibleGatewayPreset.provider,
    description: "Query Plausible analytics. Always provide the exact registered site_id, metrics, and date_range.",
    inputSchema: plausibleQueryInputSchema,
    enabled: input.enabled === true,
    driverConfig: {
      baseUrl: input.origin,
      pathTemplate: "/api/v2/query",
      method: "POST",
      allowedQueryParams: [],
      allowedJsonBodyParams: [
        "site_id",
        "metrics",
        "date_range",
        "dimensions",
        "filters",
        "include",
        "pagination",
      ],
      staticJsonBody: {},
      auth: { type: "bearer", secretName: plausibleGatewayPreset.secretName },
      timeoutMs: 10_000,
      maxResponseBytes: 1_000_000,
    },
  };
}

export function nextcrmContactReadCapability(input: {
  connectionId: string;
  origin: string;
  enabled?: boolean;
}) {
  return {
    key: nextcrmGatewayPreset.capabilityKey,
    driverKey: "mcp-tool.call",
    connectionId: input.connectionId,
    provider: nextcrmGatewayPreset.provider,
    description: "Read assigned NextCRM contacts. Use operation=list, get with id, or search with query; list and search accept optional limit and offset.",
    inputSchema: nextcrmContactReadInputSchema,
    enabled: input.enabled === true,
    driverConfig: {
      baseUrl: input.origin,
      pathTemplate: "/api/mcp/mcp",
      operations: {
        list: { toolName: "crm_list_contacts", allowedArguments: ["limit", "offset"] },
        get: { toolName: "crm_get_contact", allowedArguments: ["id"] },
        search: { toolName: "crm_search_contacts", allowedArguments: ["query", "limit", "offset"] },
      },
      auth: { type: "bearer", secretName: nextcrmGatewayPreset.secretName },
      timeoutMs: 10_000,
      maxResponseBytes: 1_000_000,
    },
  };
}

export function normalizeGatewayPresetOrigin(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function gatewayCredentialPath(input: {
  connectionId: string;
  secretName: string;
}) {
  return `/admin?tab=settings&settings=gateway&connection=${encodeURIComponent(input.connectionId)}&action=credential&secretName=${encodeURIComponent(input.secretName)}`;
}
