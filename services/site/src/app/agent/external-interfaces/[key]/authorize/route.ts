import { NextResponse } from 'next/server';
import { authorizeExternalInterface } from '@/lib/app-core';
import { credentialsForSourceMode } from '@/lib/gateway-credential-assignment';
import { requireServiceAccess } from '@/lib/internal-service';
import { readRouteParam } from '@/lib/local-admin-api';
import { listEnabledGatewayCredentialsOrEmpty } from '@/lib/prism-gateway';

type RouteContext = { params: Promise<{ key: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const credential = request.headers.get('x-prism-interface-credential')?.trim() || '';
  const result = authorizeExternalInterface({
    key: readRouteParam((await context.params).key),
    credential,
    origin: request.headers.get('x-prism-interface-origin'),
    requestId: request.headers.get('x-prism-request-id'),
    subject: request.headers.get('x-prism-external-subject'),
  });
  if (result.ok) {
    const credentials = credentialsForSourceMode(
      result.resolved.profile.mode,
      result.resolved.profile.mode === 'full' ? await listEnabledGatewayCredentialsOrEmpty() : [],
    );
    return NextResponse.json({ ...result, credentials });
  }
  const status = result.code === 'EXTERNAL_INTERFACE_NOT_FOUND' ? 404
    : result.code === 'EXTERNAL_INTERFACE_DISABLED' ? 409
      : result.code === 'EXTERNAL_INTERFACE_ORIGIN_DENIED' ? 403
        : 401;
  return NextResponse.json(result, { status });
}
