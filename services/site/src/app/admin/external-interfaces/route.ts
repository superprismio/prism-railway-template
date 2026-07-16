import { NextResponse } from 'next/server';
import { listExternalInterfaces, listInteractionAccessEvents, upsertExternalInterface } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { externalInterfaceInput } from '@/lib/external-interaction-input';

export async function GET() {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({
    ok: true,
    interfaces: listExternalInterfaces(),
    recentEvents: listInteractionAccessEvents(null, 50),
  });
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const input = externalInterfaceInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ ok: false, error: 'key and interactionProfileKey are required' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, interface: upsertExternalInterface(input) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'EXTERNAL_INTERFACE_SAVE_FAILED' }, { status: 400 });
  }
}
