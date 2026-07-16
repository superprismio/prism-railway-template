import { NextResponse } from 'next/server';
import { deleteInteractionProfile, getInteractionProfile, upsertInteractionProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';
import { interactionProfileInput } from '@/lib/external-interaction-input';
import { readRouteParam } from '@/lib/local-admin-api';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getInteractionProfile(readRouteParam((await context.params).key));
  return profile ? NextResponse.json({ ok: true, profile }) : NextResponse.json({ ok: false, error: 'Interaction profile not found' }, { status: 404 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const existing = getInteractionProfile(readRouteParam((await context.params).key));
  if (!existing) return NextResponse.json({ ok: false, error: 'Interaction profile not found' }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, profile: upsertInteractionProfile(interactionProfileInput(await request.json().catch(() => null), existing)!) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'INTERACTION_PROFILE_SAVE_FAILED' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  try {
    return deleteInteractionProfile(readRouteParam((await context.params).key))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: 'Interaction profile not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'INTERACTION_PROFILE_DELETE_FAILED' }, { status: 409 });
  }
}
