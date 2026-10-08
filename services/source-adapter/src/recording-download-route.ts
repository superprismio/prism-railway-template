import type { Express, Request, Response } from "express";

type RecordingDownloader = {
  resolveRecordingDownload(sessionId: string, fileName: string): Promise<{ filePath: string; contentType: string } | null>;
};

/** Recording files require a configured adapter token even in local deployments. */
export function registerRecordingDownloadRoute(
  app: Express,
  getVoiceManager: () => RecordingDownloader | null,
): void {
  app.get("/recordings/:sessionId/:fileName", async (request: Request, response: Response) => {
    const expectedToken = (process.env.SOURCE_ADAPTER_TOKEN ?? "").trim();
    if (!expectedToken) {
      response.status(503).json({ ok: false, error: "RECORDING_DOWNLOAD_AUTH_UNCONFIGURED" });
      return;
    }
    if (request.header("X-Adapter-Token") !== expectedToken) {
      response.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    try {
      const voiceManager = getVoiceManager();
      if (!voiceManager) {
        response.status(503).json({ ok: false, error: "VOICE_MANAGER_UNAVAILABLE" });
        return;
      }
      const sessionId = Array.isArray(request.params.sessionId) ? request.params.sessionId[0] : request.params.sessionId;
      const fileName = Array.isArray(request.params.fileName) ? request.params.fileName[0] : request.params.fileName;
      const resolved = await voiceManager.resolveRecordingDownload(sessionId, fileName);
      if (!resolved) {
        response.status(404).json({ ok: false, error: "RECORDING_NOT_FOUND" });
        return;
      }
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.type(resolved.contentType);
      response.sendFile(resolved.filePath);
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : "RECORDING_DOWNLOAD_FAILED" });
    }
  });
}
