import { NextResponse } from "next/server";
import { createCaptureSession } from "@/lib/app-core";
import { requireCapabilityAccess } from "@/lib/admin-auth";

function parseRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(parseString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  const access = await requireCapabilityAccess("canRunAgent");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const body = parseRecord(payload);
  const manifest = await createCaptureSession({
    title: parseString(body.title),
    requestId: parseString(body.requestId ?? body.request_id),
    sourcePlatform: parseString(body.sourcePlatform ?? body.source_platform),
    notes: parseString(body.notes),
    mimeType: parseString(body.mimeType ?? body.mime_type),
    audioBitsPerSecond: parseNumber(body.audioBitsPerSecond ?? body.audio_bits_per_second),
    chunkSeconds: parseNumber(body.chunkSeconds ?? body.chunk_seconds),
  });

  return NextResponse.json({ ok: true, capture: manifest }, { status: 201 });
}
