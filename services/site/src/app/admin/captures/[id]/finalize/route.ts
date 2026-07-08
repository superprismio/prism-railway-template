import { NextResponse } from "next/server";
import { finalizeCaptureSession, readCaptureDispatchSettings } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";
import { dispatchCaptureTranscript } from "@/lib/app-core/capture-dispatch";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  const payload = await request.json().catch(() => null);
  const body = parseRecord(payload);

  try {
    const capture = await finalizeCaptureSession({
      captureId: id,
      notes: parseString(body.notes),
      requestId: parseString(body.requestId ?? body.request_id),
    });
    const settings = await readCaptureDispatchSettings();
    const dispatch = capture.transcript?.status === "completed" && settings.autoDispatchOnTranscript && settings.destinationType !== "none"
      ? await dispatchCaptureTranscript(id, { baseUrl: new URL(request.url).origin, settings }).catch((error) => ({
          error: error instanceof Error ? error.message : "CAPTURE_DISPATCH_FAILED",
        }))
      : null;

    return NextResponse.json({
      ok: true,
      capture: dispatch && "manifest" in dispatch ? dispatch.manifest : capture,
      dispatch: dispatch && "result" in dispatch ? dispatch.result : null,
      dispatchError: dispatch && "error" in dispatch ? dispatch.error : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not finalize capture";
    const status = message === "CAPTURE_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
