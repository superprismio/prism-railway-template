export type InteractiveGatewayMode = "off" | "readonly" | "run-approved" | "full";

export type GatewayCapabilitySummary = {
  key?: unknown;
  mode?: unknown;
  enabled?: unknown;
};

export function interactiveGatewayCapabilityKeys(
  capabilities: GatewayCapabilitySummary[],
  mode: InteractiveGatewayMode,
) {
  if (mode === "off") return [];
  const allowWrites = mode === "full";
  return Array.from(new Set(capabilities
    .filter((capability) => capability.enabled === true)
    .filter((capability) => allowWrites || capability.mode === "read")
    .map((capability) => typeof capability.key === "string" ? capability.key.trim() : "")
    .filter((key) => /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(key))));
}
