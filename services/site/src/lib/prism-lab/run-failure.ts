export function runFailureDetails(raw: string | null | undefined) {
  if (!raw) return null;
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.error === 'string') detail = parsed.error;
  } catch { /* Older runs store plain error strings. */ }
  // Collapse repeated wrappers without hiding the underlying failure code.
  detail = detail.split(':').filter((part, index, parts) => index === 0 || part !== parts[index - 1]).join(':');
  const lease = /CREDENTIAL_LEASE_|PRISM_GATEWAY_HTTP_/.test(detail);
  const interrupted = /RUNTIME_JOB_NOT_FOUND|LEASE_EXPIRED|RUNTIME.*TIMEOUT/.test(detail);
  return {
    detail: detail.slice(0, 2000),
    label: lease ? 'Credential loading failed' : interrupted ? 'Run interrupted or timed out' : 'Run failed',
    recovery: lease
      ? 'Check the assigned credential configuration, then retry the current step.'
      : 'Check saved evidence and any completed actions before retrying the current step.',
  };
}
