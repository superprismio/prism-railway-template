export type AutoDispatchCaptureState = {
  status: string;
  chunks: Array<{ transcript?: { status: string } | null }>;
  transcript?: { status: string } | null;
};

export function captureReadyForAutoDispatch(manifest: AutoDispatchCaptureState) {
  return manifest.status === "finalized"
    && manifest.chunks.length > 0
    && manifest.transcript?.status === "completed"
    && manifest.chunks.every((chunk) => chunk.transcript?.status === "completed");
}
