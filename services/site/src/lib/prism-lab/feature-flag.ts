/**
 * Prism Lab is an opt-in field-test surface. Only an explicit `true` enables
 * the route; missing, empty, false, and unrecognized values fail closed.
 */
export function isPrismLabEnabled(value: string | null | undefined) {
  return value?.trim().toLowerCase() === "true";
}
