import { NextResponse } from 'next/server';
import { listInteractionProfiles, upsertInteractionProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { interactionProfileInput } from '@/lib/external-interaction-input';

export async function GET() {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  return NextResponse.json({ ok: true, profiles: listInteractionProfiles() });
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const input = interactionProfileInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ ok: false, error: 'key is required' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, profile: upsertInteractionProfile(input) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'INTERACTION_PROFILE_SAVE_FAILED' }, { status: 400 });
  }
}
