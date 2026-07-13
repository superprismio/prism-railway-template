export type InteractiveGatewayMode = "off" | "readonly" | "run-approved" | "full";

export type GatewayCapabilitySummary = {
  key?: unknown;
  mode?: unknown;
  enabled?: unknown;
  description?: unknown;
  inputSchema?: unknown;
};

export type GatewayCapabilityDescriptor = {
  key: string;
  mode?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export function interactiveGatewayCapabilities(
  capabilities: GatewayCapabilitySummary[],
  mode: InteractiveGatewayMode,
): GatewayCapabilityDescriptor[] {
  if (mode === "off") return [];
  const allowWrites = mode === "full";
  return capabilities
    .filter((capability) => capability.enabled === true)
    .filter((capability) => allowWrites || capability.mode === "read")
    .flatMap((capability) => {
      const key = typeof capability.key === "string" ? capability.key.trim() : "";
      if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key)) return [];
      const inputSchema = capability.inputSchema && typeof capability.inputSchema === "object" && !Array.isArray(capability.inputSchema)
        ? capability.inputSchema as Record<string, unknown>
        : undefined;
      return [{
        key,
        ...(typeof capability.mode === "string" ? { mode: capability.mode } : {}),
        ...(typeof capability.description === "string" && capability.description.trim()
          ? { description: capability.description.trim() }
          : {}),
        ...(inputSchema ? { inputSchema } : {}),
      }];
    });
}

export function interactiveGatewayCapabilityKeys(
  capabilities: GatewayCapabilitySummary[],
  mode: InteractiveGatewayMode,
) {
  return Array.from(new Set(interactiveGatewayCapabilities(capabilities, mode).map((capability) => capability.key)));
}
