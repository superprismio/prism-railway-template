// Existing lease policy, shared by automatic alias generation and HTTP validation.
export function isProtectedLeasedEnvironmentName(name: string) {
  return new Set([
    "PATH", "HOME", "SHELL", "PWD", "TMPDIR", "NODE_OPTIONS",
    "INTERNAL_SERVICE_TOKEN", "APP_API_SERVICE_TOKEN", "TASK_RUNNER_TOKEN",
    "COMMUNICATION_ADAPTER_TOKEN",
  ]).has(name)
    || ["PRISM_", "RAILWAY_", "GATEWAY_", "CODEX_", "NODE_", "NPM_", "npm_", "LD_", "DYLD_"]
      .some((prefix) => name.startsWith(prefix));
}

export function generatedEnvironmentName(prefix: string, suffix: string) {
  const name = `${prefix}_${suffix}`;
  return isProtectedLeasedEnvironmentName(name) ? `CREDENTIAL_${name}` : name;
}
