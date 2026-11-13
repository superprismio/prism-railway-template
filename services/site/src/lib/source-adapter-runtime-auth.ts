import { timingSafeEqual } from 'node:crypto';

/** A service token alone never grants request-creator minting authority. */
export function hasSourceAdapterRuntimeAccess(input: {
  presented: string | null;
  expected: string | undefined;
  serviceToken: string;
  adapterToken?: string | undefined;
}) {
  const expected = input.expected?.trim();
  const presented = input.presented?.trim();
  if (!expected || !presented || expected === input.serviceToken || expected === input.adapterToken) return false;
  const actualBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function authorizeRuntimeCreatorMint(input: Parameters<typeof hasSourceAdapterRuntimeAccess>[0] & {
  requestOrigin: unknown;
}) {
  const allowed = hasSourceAdapterRuntimeAccess(input);
  return {
    allowed,
    error: input.requestOrigin && !allowed ? 'SOURCE_ADAPTER_RUNTIME_TOKEN_REQUIRED' : null,
  };
}
