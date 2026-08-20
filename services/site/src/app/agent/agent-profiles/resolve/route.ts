import { NextResponse } from 'next/server';

import { resolveAgentProfileBinding } from '@/lib/app-core';
import { parseString, requireServiceAccess } from '@/lib/internal-service';

const surfaceTypes = ['buzz', 'discord', 'telegram', 'external', 'user'] as const;

export async function GET(request: Request) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const url = new URL(request.url);
  const surfaceType = parseString(url.searchParams.get('surfaceType'));
  const surfaceKey = parseString(url.searchParams.get('surfaceKey'));
  if (!surfaceTypes.includes(surfaceType as typeof surfaceTypes[number]) || !surfaceKey) {
    return NextResponse.json({ ok: false, error: 'A supported surfaceType and surfaceKey are required' }, { status: 400 });
  }
  const profile = resolveAgentProfileBinding(surfaceType as typeof surfaceTypes[number], surfaceKey);
  return profile
    ? NextResponse.json({ ok: true, profile })
    : NextResponse.json({ ok: true, profile: null });
}
