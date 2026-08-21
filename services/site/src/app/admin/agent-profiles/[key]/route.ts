import { NextResponse } from 'next/server';

import { createAuditLog, getAgentProfile, upsertAgentProfile } from '@/lib/app-core';
import { requireCapabilityAccess } from '@/lib/admin-auth';

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canRunAgent');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  return profile
    ? NextResponse.json({ ok: true, profile })
    : NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => text(entry, 160)).filter(Boolean);
  return text(value, 4000).split(',').map((entry) => entry.trim()).filter(Boolean);
}

export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const access = await requireCapabilityAccess('canManageSettings');
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  const profile = getAgentProfile((await context.params).key);
  if (!profile) return NextResponse.json({ ok: false, error: 'Agent Profile not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  const name = text(body.name, 160);
  if (!name) return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
  const personaInstructions = text(body.personaInstructions ?? body.persona_instructions, 20_000);
  try {
    const updated = upsertAgentProfile({
      key: profile.key,
      name,
      description: text(body.description, 2000) || null,
      avatarUrl: text(body.avatarUrl ?? body.avatar_url, 2000) || null,
      status: profile.status,
      ownerType: profile.owner.type,
      ownerUserId: profile.owner.userId,
      ownerAgentProfileId: profile.owner.agentProfileId,
      stewardUserIds: profile.stewards.map((steward) => steward.userId),
      persona: { ...profile.persona, name, instructions: personaInstructions },
      runtimeProfileKey: text(body.runtimeProfileKey ?? body.runtime_profile_key, 120) || null,
      skills: stringList(body.skills),
      memoryScope: profile.memoryScope,
      authority: profile.authority,
      contextPolicy: profile.contextPolicy,
      createdByUserId: access.userId,
      allowSystemProfileUpdate: Boolean(profile.systemKey),
    });
    createAuditLog({
      actorUserId: access.userId,
      actionType: 'admin.agent_profile.update',
      targetType: 'agent_profile',
      targetId: profile.id,
      meta: { key: profile.key, version: updated.version },
    });
    return NextResponse.json({ ok: true, profile: updated });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'AGENT_PROFILE_UPDATE_FAILED' }, { status: 400 });
  }
}
