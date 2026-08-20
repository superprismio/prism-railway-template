import { NextResponse } from 'next/server';

import { getAgentProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canRunAgent');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  return profile
    ? NextResponse.json({ ok: true, profile })
    : NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
}
