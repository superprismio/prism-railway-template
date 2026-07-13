export type GatewayEnvImportDefinition = {
  key: string;
  provider: string;
  label: string;
  authType: string;
  credentialVariables: Record<string, string>;
  configurationVariables: string[];
  readiness: "ready" | "adapter-required";
};

export const gatewayEnvImportDefinitions: GatewayEnvImportDefinition[] = [
  {
    key: "storage.s3",
    provider: "s3-storage",
    label: "S3 Object Storage",
    authType: "aws-credentials",
    credentialVariables: {
      AWS_ACCESS_KEY_ID: "accessKeyId",
      AWS_SECRET_ACCESS_KEY: "secretAccessKey",
    },
    configurationVariables: ["STORAGE_S3_BUCKET", "STORAGE_S3_ENDPOINT", "STORAGE_S3_PREFIX", "STORAGE_S3_REGION"],
    readiness: "adapter-required",
  },
  {
    key: "github.admin",
    provider: "github",
    label: "GitHub",
    authType: "bearer",
    credentialVariables: { TARGET_REPO_GITHUB_TOKEN: "apiToken" },
    configurationVariables: [],
    readiness: "adapter-required",
  },
  {
    key: "nextcrm.admin",
    provider: "nextcrm",
    label: "NextCRM",
    authType: "bearer",
    credentialVariables: { NEXTCRM_API_TOKEN: "apiToken" },
    configurationVariables: ["NEXTCRM_BASE_URL", "NEXTCRM_MCP_URL", "NEXTCRM_MCP_SSE_URL"],
    readiness: "adapter-required",
  },
  {
    key: "x.admin",
    provider: "x",
    label: "X Developer API",
    authType: "oauth-1a",
    credentialVariables: {
      X_ACCESS_TOKEN: "accessToken",
      X_ACCESS_TOKEN_SECRET: "accessTokenSecret",
      X_API_KEY: "apiKey",
      X_API_SECRET: "apiSecret",
      X_BEARER_TOKEN: "bearerToken",
      X_CONSUMER_KEY: "consumerKey",
      X_CONSUMER_SECRET: "consumerSecret",
    },
    configurationVariables: [],
    readiness: "adapter-required",
  },
  {
    key: "bankr.admin",
    provider: "bankr",
    label: "Bankr",
    authType: "api-key",
    credentialVariables: { BANKR_API_KEY: "apiKey" },
    configurationVariables: [],
    readiness: "adapter-required",
  },
  {
    key: "clawbank.admin",
    provider: "clawbank",
    label: "Clawbank",
    authType: "api-key",
    credentialVariables: { CLAWBANK_API_KEY: "apiKey" },
    configurationVariables: ["CLAWBANK_MCP_URL"],
    readiness: "adapter-required",
  },
  {
    key: "hive-mind.admin",
    provider: "hivemind",
    label: "Hivemind Strategy",
    authType: "api-key",
    credentialVariables: { HIVE_MIND_API_KEY: "apiKey", HIVEMIND_API_KEY: "apiKey" },
    configurationVariables: [],
    readiness: "ready",
  },
  {
    key: "wallet.admin",
    provider: "evm-wallet",
    label: "EVM Wallet",
    authType: "private-key",
    credentialVariables: { PRIVATE_KEY: "privateKey" },
    configurationVariables: ["ACCOUNT_ADDRESS"],
    readiness: "adapter-required",
  },
];

export const retainedGatewayEnvVariables = new Set([
  "APP_API_SERVICE_TOKEN",
  "COMMUNICATION_ADAPTER_TOKEN",
  "PRISM_API_KEY",
  "PRISM_GATEWAY_TOKEN",
  "VENICE_API_KEY",
]);

export function ignoredSensitiveGatewayEnvNames(parsed: Record<string, string>) {
  const classifiedNames = new Set(gatewayEnvImportDefinitions.flatMap((definition) => [
    ...Object.keys(definition.credentialVariables),
    ...definition.configurationVariables,
  ]));

  return Object.keys(parsed).filter(
    (name) =>
      /(KEY|TOKEN|SECRET|PASSWORD|PRIVATE)/.test(name) &&
      !classifiedNames.has(name) &&
      !retainedGatewayEnvVariables.has(name) &&
      name !== "PRISM_RUNTIME_KEY" &&
      !name.startsWith("RAILWAY_"),
  );
}

export function parseEnvText(value: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let entry = line.slice(separator + 1).trim();
    if ((entry.startsWith('"') && entry.endsWith('"')) || (entry.startsWith("'") && entry.endsWith("'"))) {
      entry = entry.slice(1, -1);
    }
    if (entry) parsed[name] = entry;
  }
  return parsed;
}
