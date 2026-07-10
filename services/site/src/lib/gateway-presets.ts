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
  capabilityKey: "plausible.stats.query",
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
