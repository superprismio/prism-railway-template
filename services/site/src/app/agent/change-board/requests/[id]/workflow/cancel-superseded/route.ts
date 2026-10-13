import { NextResponse } from 'next/server';
import { cancelSupersededRequest } from '@/lib/app-core/superseded-request';
import { requireServiceAccess } from '@/lib/internal-service';

type Context = { params: Promise<{ id: string }> };
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const numbers = (value: unknown) => Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && item > 0) ? value as number[] : null;
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim()) ? value as string[] : null;

export async function POST(request: Request, context: Context) {
  const access = await requireServiceAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return NextResponse.json({ ok: false, error: 'INVALID_BODY' }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const dryRun = body.dryRun !== false;
  const successorRequestNumbers = numbers(body.successorRequestNumbers);
  const evidenceArtifactIds = strings(body.evidenceArtifactIds);
  const expectedWorkflowVersion = body.expectedWorkflowVersion;
  if (body.reason !== 'superseded' || !successorRequestNumbers || !evidenceArtifactIds || !Number.isSafeInteger(expectedWorkflowVersion) || !string(body.expectedWorkflowRunId) || !string(body.expectedStepKey) || !string(body.maintenanceRequestId) || !string(body.maintenanceAgentRunId) || !string(body.comment)) {
    return NextResponse.json({ ok: false, error: 'INVALID_SUPERSESSION_PROOF' }, { status: 400 });
  }
  const { id } = await context.params;
  const result = cancelSupersededRequest({
    targetRequestId: id,
    successorRequestNumbers,
    evidenceArtifactIds,
    expectedWorkflowRunId: string(body.expectedWorkflowRunId),
    expectedStepKey: string(body.expectedStepKey),
    expectedWorkflowVersion: expectedWorkflowVersion as number,
    maintenanceRequestId: string(body.maintenanceRequestId),
    maintenanceAgentRunId: string(body.maintenanceAgentRunId),
    comment: string(body.comment),
    dryRun,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 'error' in result && result.error === 'REQUEST_NOT_FOUND' ? 404 : 409 });
}
