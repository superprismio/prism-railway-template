export type CapabilityDescriptor = {
  key: string;
  mode?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export function mergeSkillCapabilityRequirements(
  capabilities: CapabilityDescriptor[],
  skills: Array<{ requiredCapabilities: string[] }>,
) {
  const byKey = new Map(capabilities.map((capability) => [capability.key, capability]));
  for (const skill of skills) {
    for (const key of skill.requiredCapabilities) {
      if (!byKey.has(key)) byKey.set(key, { key });
    }
  }
  return [...byKey.values()];
}
