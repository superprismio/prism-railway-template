export function redactDiagnostic(text: string, secrets: string[] = []) {
  let safe = text;
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join('[redacted]');
  }
  return safe
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?[redacted]')
    .replace(/(bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

export class ScriptFailure extends Error {
  readonly diagnostics: Record<string, unknown>;
  constructor(input: {
    scriptKey: string; exitCode: number | null; signal?: string | null;
    stdout: string; stderr: string; secrets?: string[]; timedOut?: boolean;
  }) {
    let structured = '';
    try {
      const body = JSON.parse(input.stdout);
      const error = body?.error;
      structured = typeof error === 'string' ? error
        : error && typeof error === 'object'
          ? [error.code, error.message].filter(v => typeof v === 'string').join(': ') : '';
    } catch { /* Arbitrary stdout may contain results or secrets; don't persist it. */ }
    const stderr = redactDiagnostic(input.stderr, input.secrets).slice(0, 2000);
    const detail = redactDiagnostic(structured, input.secrets).slice(0, 2000);
    const code = input.timedOut ? 'SCRIPT_RUNNER_TIMEOUT' : 'SCRIPT_RUNNER_FAILED';
    super(`${code}:${input.scriptKey}:exit=${input.exitCode ?? 'none'}:signal=${input.signal ?? 'none'}:${detail || stderr || 'No error details emitted by script'}`);
    this.diagnostics = { stage: 'script_execution', code, scriptKey: input.scriptKey,
      exitCode: input.exitCode, signal: input.signal ?? null, timedOut: input.timedOut === true,
      stderr, structuredError: detail, outputTruncated: input.stderr.length > 2000 || structured.length > 2000,
      recovery: 'Inspect script output and any completed side effects before retrying.' };
  }
}
