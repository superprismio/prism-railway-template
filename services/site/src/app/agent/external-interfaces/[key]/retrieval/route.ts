import { authorizeExternalInterface, loadConfig } from '@/lib/app-core';
import { requireServiceAccess } from '@/lib/internal-service';
import { scopedMemoryRetrieval } from '@/lib/scoped-memory-retrieval';

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireServiceAccess();
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  return scopedMemoryRetrieval(request, (await context.params).key, {
    authorize: authorizeExternalInterface,
    baseUrl: loadConfig().prismMemoryBaseUrl,
    serviceKey: process.env.PRISM_RETRIEVAL_SERVICE_KEY?.trim() || '',
  });
}
