import { NextResponse } from 'next/server';

import { createAuditLog, getAgentProfile, upsertAgentProfileBinding } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

const surfaceTypes = ['buzz', 'discord', 'telegram', 'external', 'user'] as const;

function text(value: unknown, maxLength = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const surfaceType = text(body?.surfaceType, 40);
  const surfaceKey = text(body?.surfaceKey);
  if (!surfaceTypes.includes(surfaceType as typeof surfaceTypes[number]) || !surfaceKey) {
    return NextResponse.json({ ok: false, error: 'A supported surfaceType and surfaceKey are required' }, { status: 400 });
  }
  try {
    const binding = upsertAgentProfileBinding({
      profileId: profile.id,
      surfaceType: surfaceType as typeof surfaceTypes[number],
      surfaceKey,
      label: text(body?.label) || null,
      enabled: body?.enabled !== false,
      createdByUserId: access.userId,
    });
    createAuditLog({ actorUserId: access.userId, actionType: 'admin.agent_profile.binding.upsert', targetType: 'agent_profile', targetId: profile.id, meta: { surfaceType, surfaceKey } });
    return NextResponse.json({ ok: true, binding });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_PROFILE_BINDING_FAILED' }, { status: 400 });
  }
}
