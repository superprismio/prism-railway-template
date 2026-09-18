import { authorizeExternalInterface, hasAgentProfileBinding, resolveAgentProfileInteraction, loadConfig } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';
import { scopedMemoryRetrieval, effectiveRetrievalAuthorization } from '@/lib/scoped-memory-retrieval';

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  return scopedMemoryRetrieval(request, (await context.params).key, {
    authorize: input => {
      const auth = authorizeExternalInterface(input);
      if (!auth.ok) return auth;
      return effectiveRetrievalAuthorization(auth,
        resolveAgentProfileInteraction({ surfaceType: 'external', surfaceKey: input.key }),
        hasAgentProfileBinding('external', input.key));
    },
    baseUrl: loadConfig().prismMemoryBaseUrl,
    serviceKey: process.env.PRISM_RETRIEVAL_SERVICE_KEY?.trim() || '',
  });
}
