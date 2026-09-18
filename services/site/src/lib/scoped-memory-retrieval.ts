import type { InteractionProfileRecord } from './app-core/external-interactions';

type Authorization = { ok: false; code: string } | {
  ok: true; resolved: { profile: Pick<InteractionProfileRecord, 'mode' | 'memoryScope'> };
};
type Dependencies = {
  authorize: (input: { key: string; credential: string; origin: string | null }) => Authorization;
  baseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
};

/** Match the canonical interface authorization route during profile migration. */
export function effectiveRetrievalAuthorization(
  auth: Authorization,
  agent: { policy: { accessMode: string; capabilities: string[] }; profile: { memoryScope: Record<string, unknown> } } | null,
  hasBinding: boolean,
): Authorization {
  if (!auth.ok) return auth;
  if ((!agent && hasBinding) || agent?.policy.accessMode === 'off') {
    return { ok: false, code: 'EXTERNAL_INTERFACE_DISABLED' };
  }
  if (!agent) return auth;
  // A binding may remove memory access even while its access mode stays enabled.
  if (!Array.isArray(agent.policy.capabilities) || !agent.policy.capabilities.includes('memory.read')) {
    return { ok: false, code: 'MEMORY_READ_FORBIDDEN' };
  }
  const scope = agent.profile.memoryScope;
  const strings = (value: unknown): string[] | null => value === undefined ? []
    : Array.isArray(value) && value.every(v => typeof v === 'string') ? value : null;
  const buckets = strings(scope.buckets), knowledgeSourceIds = strings(scope.knowledgeSourceIds);
  if (!buckets || !knowledgeSourceIds) return { ok: false, code: 'MEMORY_SCOPE_INVALID' };
  return { ok: true, resolved: { profile: {
    mode: auth.resolved.profile.mode,
    memoryScope: { buckets, knowledgeSourceIds, instructions: '', enforcement: 'instructions-only' },
  } } };
}

/** Service-authenticated callers must additionally prove the interface identity. */
export async function scopedMemoryRetrieval(request: Request, interfaceKey: string, deps: Dependencies): Promise<Response> {
  const auth = deps.authorize({
    key: interfaceKey,
    credential: request.headers.get('x-prism-interface-credential')?.trim() || '',
    origin: request.headers.get('x-prism-interface-origin'),
  });
  if (!auth.ok) return Response.json({ error: 'Interface access denied' }, { status: 403 });
  if (auth.resolved.profile.mode === 'off') return Response.json({ error: 'Interface disabled' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
    body = raw as Record<string, unknown>;
    if (Object.keys(body).some(k => !['operation', 'arguments'].includes(k))) throw new Error();
    if (!['search', 'context', 'meetings', 'meeting', 'coverage'].includes(String(body.operation))) throw new Error();
    if (body.arguments !== undefined && (!body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments))) throw new Error();
  } catch {
    return Response.json({ error: 'Invalid retrieval request' }, { status: 400 });
  }
  if (!deps.baseUrl || !deps.serviceKey) return Response.json({ error: 'Scoped retrieval unavailable' }, { status: 503 });
  // Ignore advisory prose. Only selectors loaded from the current profile confer access.
  const scope = auth.resolved.profile.memoryScope;
  try {
    const response = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl.replace(/\/+$/, '')}/retrieval/scoped`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', 'X-Prism-Retrieval-Key': deps.serviceKey },
      body: JSON.stringify({ operation: body.operation, arguments: body.arguments ?? {},
        scope: { buckets: scope.buckets, knowledge_source_ids: scope.knowledgeSourceIds } }),
    });
    if (!response.ok) return Response.json({ error: 'Retrieval request unavailable or rejected' },
      { status: [400, 401, 403, 404, 409, 422, 503].includes(response.status) ? response.status : 502 });
    return Response.json(await response.json(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Memory service unavailable' }, { status: 503 });
  }
}
