import { config } from './config.js';
import { PrismGatewayClient } from './gateway-client.js';
import { RuntimeCapabilitySessions } from './runtime-capabilities.js';

export const gatewayClient = new PrismGatewayClient({
  enabled: config.prismGatewayEnabled,
  baseUrl: config.prismGatewayBaseUrl,
  token: config.prismGatewayToken,
  timeoutMs: config.prismGatewayTimeoutMs,
});

export const runtimeCapabilitySessions = new RuntimeCapabilitySessions(
  gatewayClient,
);
