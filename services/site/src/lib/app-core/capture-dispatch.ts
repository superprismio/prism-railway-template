import {
  getCaptureManifest,
  markCaptureDispatchCompleted,
  markCaptureDispatchFailed,
  markCaptureDispatchPending,
  readCaptureSummaryFiles,
  readCaptureTranscriptFiles,
  type CaptureManifest,
} from "./capture-storage";
import { readCaptureDispatchSettings, type CaptureDispatchSettings } from "./capture-settings";
import { triggerHook } from "@/lib/hook-trigger";

type CaptureDispatchPayload = {
  event: "capture.transcript.completed";
  capture: CaptureManifest;
  transcript: {
    markdown: string;
    json: unknown;
  };
  summary: {
    markdown: string;
    json: unknown;
  } | null;
};

function redactedSettings(settings: CaptureDispatchSettings) {
  return {
    destinationType: settings.destinationType,
    prismHookKey: settings.prismHookKey,
    externalUrl: settings.externalUrl,
    externalHeaderName: settings.externalHeaderName,
    externalHeaderValue: settings.externalHeaderValue ? "[redacted]" : null,
    autoDispatchOnTranscript: settings.autoDispatchOnTranscript,
  };
}

async function buildDispatchPayload(captureId: string): Promise<CaptureDispatchPayload> {
  const transcript = await readCaptureTranscriptFiles(captureId);
  const summary = await readCaptureSummaryFiles(captureId).catch((error) => {
    if (error instanceof Error && error.message === "CAPTURE_SUMMARY_NOT_READY") return null;
    throw error;
  });
  return {
    event: "capture.transcript.completed",
    capture: summary?.manifest ?? transcript.manifest,
    transcript: {
      markdown: transcript.markdown,
      json: transcript.json,
    },
    summary: summary ? {
      markdown: summary.markdown,
      json: summary.json,
    } : null,
  };
}

async function dispatchToExternalHttp(settings: CaptureDispatchSettings, payload: CaptureDispatchPayload) {
  if (!settings.externalUrl) {
    throw new Error("CAPTURE_DISPATCH_EXTERNAL_URL_REQUIRED");
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (settings.externalHeaderName && settings.externalHeaderValue) {
    headers[settings.externalHeaderName] = settings.externalHeaderValue;
  }
  const response = await fetch(settings.externalUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`CAPTURE_DISPATCH_EXTERNAL_FAILED:${response.status}:${responseText.slice(0, 300)}`);
  }
  return {
    status: response.status,
    body: responseText.slice(0, 1000),
  };
}

export async function dispatchCaptureTranscript(captureId: string, options: {
  baseUrl?: string | null;
  settings?: CaptureDispatchSettings;
} = {}) {
  const settings = options.settings ?? await readCaptureDispatchSettings();
  const manifest = await getCaptureManifest(captureId);
  if (!manifest) {
    throw new Error("CAPTURE_NOT_FOUND");
  }
  if (manifest.transcript?.status !== "completed") {
    throw new Error("CAPTURE_TRANSCRIPT_NOT_READY");
  }
  if (settings.destinationType === "none") {
    throw new Error("CAPTURE_DISPATCH_NOT_CONFIGURED");
  }

  const destination = settings.destinationType === "prism-hook"
    ? settings.prismHookKey
    : settings.externalUrl;
  if (!destination) {
    throw new Error("CAPTURE_DISPATCH_DESTINATION_REQUIRED");
  }

  await markCaptureDispatchPending({
    captureId,
    destinationType: settings.destinationType,
    destination,
  });

  try {
    const payload = await buildDispatchPayload(captureId);
    const result = settings.destinationType === "prism-hook"
      ? await triggerHook(settings.prismHookKey ?? "", payload, {
          baseUrl: options.baseUrl,
          source: `capture:${captureId}`,
          waitForAutoStart: false,
        })
      : await dispatchToExternalHttp(settings, payload);
    const updated = await markCaptureDispatchCompleted({
      captureId,
      destinationType: settings.destinationType,
      destination,
      result,
    });
    return {
      manifest: updated,
      result,
      settings: redactedSettings(settings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAPTURE_DISPATCH_FAILED";
    await markCaptureDispatchFailed({
      captureId,
      destinationType: settings.destinationType,
      destination,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}
