import { NextResponse } from "next/server";
import { transcribeCaptureSession } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function transcriptionErrorStatus(message: string) {
  if (message === "CAPTURE_NOT_FOUND") return 404;
  if (message === "CAPTURE_NOT_FINALIZED" || message === "CAPTURE_HAS_NO_CHUNKS") return 409;
  if (message === "CAPTURE_TRANSCRIPTION_NOT_CONFIGURED") return 501;
  return 500;
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { id } = await context.params;
  try {
    const result = await transcribeCaptureSession(id);
    return NextResponse.json({ ok: true, capture: result.manifest, transcript: result.transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_TRANSCRIPTION_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: transcriptionErrorStatus(message) });
  }
}
