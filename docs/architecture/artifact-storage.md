# Artifact Storage

Prism request artifacts are the durable file surface for workflow outputs, user uploads, and agent-produced handoff files. The current implementation is intentionally additive: existing workflow artifacts keep using the request artifact table and local file storage, while user uploads enter through the same artifact model.

## Current Slice

- Admin users with comment access can upload a local file on a request.
- The upload is stored under the site service `DATA_ROOT` using the existing request artifact storage helpers.
- The artifact row is attached to the request and appears in the request Artifacts tab.
- Uploads are not automatically indexed into Prism Memory or Prism Knowledge.

Current storage path:

```text
${DATA_ROOT}/workflow-artifacts/requests/<request-id>/<artifact-id>-<filename>
```

Current optional limit:

```env
ARTIFACT_MAX_UPLOAD_MB=50
```

If the env var is omitted, the site defaults to 50 MB. The first slice keeps uploads flowing through the site API rather than signed direct-to-bucket uploads.

## Artifact Shapes

Prism should keep one artifact metadata contract while allowing several backing shapes:

- `local`: file stored under the site data volume.
- `external`: metadata points at a URL produced by another system, such as a Remotion render bucket.
- `bucket`: future Prism-owned S3/Railway bucket object storage.
- `inline`: future option for small text payloads if useful, though current workflow artifacts already use file-backed storage.

The artifact row should remain the source of truth for:

- request id
- optional workflow run id
- optional execution id
- kind
- name
- MIME type
- size
- storage path or object key
- metadata
- creator/source

## Future Provider Interface

When bucket storage is needed, add a provider behind the existing artifact storage helper instead of changing callers:

```ts
type ArtifactStorageProvider = {
  write(storageKey: string, body: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
};
```

Suggested env shape:

```env
ARTIFACT_STORAGE_DRIVER=local
ARTIFACT_STORAGE_ROOT=/data/workflow-artifacts
ARTIFACT_MAX_UPLOAD_MB=50

# Future bucket/S3-compatible driver
ARTIFACT_STORAGE_DRIVER=s3
ARTIFACT_BUCKET_NAME=
ARTIFACT_BUCKET_REGION=
ARTIFACT_BUCKET_ENDPOINT=
ARTIFACT_ACCESS_KEY_ID=
ARTIFACT_SECRET_ACCESS_KEY=
```

The default should remain `local` so template instances work without new configuration.

## Remotion Workflows

Remotion workflows do not need to change immediately. If a separate Remotion service writes to a Railway bucket, the workflow can register the render receipt, thumbnail, and video URL as Prism request artifacts. Later, if Prism owns the bucket, the Remotion workflow can upload through Prism artifact storage and register the same artifact metadata.

Useful Remotion artifact set:

- `render-plan.json`
- `render-attempt.json`
- `render-receipt.json`
- `thumbnail.png`
- `video.mp4` or an external video URL artifact
- `publish-receipt.json`

## Memory and Knowledge

Uploads should not automatically become Memory or Knowledge. A workflow or agent should explicitly decide whether to:

- summarize the file into a markdown/text artifact,
- index that summary into Prism Knowledge,
- include it in a request review,
- or leave it as request-local context only.
