import { config } from './config.js';
import { PrismGatewayClient } from './gateway-client.js';
import { RuntimeCapabilitySessions } from './runtime-capabilities.js';
import { RuntimeToolsetSessions } from './runtime-toolsets.js';

export const gatewayClient = new PrismGatewayClient({
  enabled: config.prismGatewayEnabled,
  baseUrl: config.prismGatewayBaseUrl,
  token: config.prismGatewayToken,
  timeoutMs: config.prismGatewayTimeoutMs,
});

export const runtimeCapabilitySessions = new RuntimeCapabilitySessions(
  gatewayClient,
);

export const runtimeToolsetSessions = new RuntimeToolsetSessions(gatewayClient);
