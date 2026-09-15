import type { AgentProfileRecord } from "./app-core";
import { filterGatewayCredentialKeysForProfile } from "./agent-profile-runtime-scope";

export type GatewayCredentialDescriptor = { key: string };

export function credentialsForSourceMode(
  mode: "off" | "readonly" | "run-approved" | "full",
  credentials: GatewayCredentialDescriptor[],
  profile: AgentProfileRecord | null = null,
) {
  return mode === "full"
    ? filterGatewayCredentialKeysForProfile(profile, credentials.map((credential) => credential.key)).map((key) => ({ key }))
    : [];
}

export function trustedCredentialKeys(credentials: GatewayCredentialDescriptor[]) {
  return Array.from(new Set(credentials.map((credential) => credential.key).filter(Boolean)));
}
