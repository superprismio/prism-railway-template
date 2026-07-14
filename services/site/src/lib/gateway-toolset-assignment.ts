export type GatewayToolset = {
  key: string;
  protocol?: "openapi" | "mcp" | "http" | "adapter";
  [key: string]: unknown;
};

type GatewayCredential = {
  key: string;
  protocol: "adapter";
  toolsetKeys: string[];
};

export function interactiveGatewayToolsets(
  toolsets: GatewayToolset[],
  credentials: GatewayCredential[],
) {
  const enabledToolsetKeys = new Set(toolsets.map((toolset) => toolset.key));
  const standaloneCredentials = credentials
    .filter((credential) => !credential.toolsetKeys.some((key) => enabledToolsetKeys.has(key)))
    .map(({ key, protocol }) => ({ key, protocol }));
  return Array.from(new Map([
    ...toolsets,
    ...standaloneCredentials,
  ].map((entry) => [entry.key, entry])).values());
}

export function gatewayToolsetsForKeys(keys: string[], enabledToolsets: GatewayToolset[]) {
  return Array.from(new Set(keys)).map((key) =>
    enabledToolsets.find((toolset) => toolset.key === key) ?? { key },
  );
}

export function trustedRuntimeAdapterToolsets(enabledToolsets: GatewayToolset[]) {
  return enabledToolsets.filter((toolset) => toolset.protocol === "adapter");
}
