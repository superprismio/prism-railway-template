export function parseEstimatedHumanHours(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999) {
    return undefined;
  }
  return Math.round(parsed * 100) / 100;
}
