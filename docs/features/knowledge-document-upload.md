# Knowledge Document Upload

## Status

Planned / future feature.

## Purpose

Give an authenticated Prism operator a direct way to add standalone knowledge
documents from the existing Memory Explorer. The operator should be able to
select or drag Markdown files into a Knowledge Inbox, review the metadata Prism
will use, and submit the documents for the existing knowledge promotion and
indexing pipeline.

The first slice should use the existing manual Knowledge contract instead of
creating a second document store or bypassing triage:

```text
/admin/memory Knowledge Inbox
        |
        v
Site admin upload route
        |
        v
Prism Memory POST /knowledge/inbox
        |
        v
knowledge/kb/triage/inbox/*.md + *.meta.json
        |
        v
scheduled knowledge-run: promote -> validate -> index
        |
        v
canonical searchable Prism Knowledge document
```

Although this feature lives under `/admin/memory`, uploads in this feature are
Knowledge documents. They are not rolling-memory inbox records.

## Memory And Knowledge Boundary

Prism has two different inbox semantics:

- `POST /memory/inbox` stores chronological activity, meeting summaries,
  session attachments, and other evidence that can feed digests, rolling
  memory, signals, and objectives. It writes JSON records under
  `inbox/memory/incoming/`.
- `POST /knowledge/inbox` stores manual or agent-authored evergreen documents
  with required retrieval metadata. It writes a Markdown document and metadata
  sidecar under `knowledge/kb/triage/inbox/`.
- Git repositories that should remain synchronized are Knowledge sources and
  must use `/knowledge/sources`, not repeated manual uploads.

The upload surface should explain this distinction in plain language:

```text
Knowledge Inbox

Upload durable references such as guides, policies, architecture notes, and
templates. Meeting notes, transcripts, and short-lived updates usually belong
in Memory instead. Connect a GitHub source when these files should stay synced
with a repository.
```

Do not add a lane selector in the first slice. A control that switches the same
file between Memory and Knowledge would hide important differences in metadata,
lifecycle, and downstream use. The existing Memory attachment and promotion
flows can continue to handle memory-lane documents.

## Current Implementation Constraints

The current manual Knowledge write contract is JSON, not multipart upload:

```json
{
  "filename": "ops-playbook.md",
  "content": "# Ops Playbook\n\nBody...",
  "metadata": {
    "title": "Ops Playbook",
    "slug": "ops-playbook",
    "kind": "guide",
    "summary": "How to run core guild operations.",
    "tags": ["knowledge", "operations"],
    "owners": ["ops-team"],
    "status": "draft",
    "audience": "internal",
    "stability": "evolving",
    "updated": "2026-07-15T18:00:00Z",
    "entities": [],
    "related_docs": [],
    "triaged_at": "2026-07-15T18:00:00Z"
  }
}
```

Current backend behavior:

- `filename` must use the `.md` extension.
- The document body must be non-empty.
- A metadata sidecar is required.
- Metadata is validated against the deployed Knowledge configuration.
- The starter requires title, slug, kind, summary, tags, owners, status,
  audience, stability, updated, entities, related docs, and triaged time.
- Allowed kinds and tags are instance-configured. The starter kinds are
  architecture, guide, policy, proposal, reference, and note.
- The Knowledge promotion command only reads `*.md` files from the triage
  inbox.
- `knowledge-run` promotes valid candidates, validates canonical docs, and
  rebuilds indexes. The built-in task is disabled until an operator enables it;
  its seeded schedule is `55 * * * *`.
- A legacy Railway `knowledge-cron` may perform the same operation on older
  instances. An instance should use one scheduler, not both.

## Supported Files

The first slice should allow only:

| File | Picker value | Behavior |
| --- | --- | --- |
| Markdown | `.md` | Decode as UTF-8 and submit its text body to `/knowledge/inbox`. |

Use an input accept value similar to:

```text
.md,text/markdown,text/plain
```

The `.md` filename is authoritative because browsers may report Markdown as
`text/plain`, an empty MIME type, or `application/octet-stream`. MIME type alone
must not make another extension eligible.

Reject in the browser and on the Site server:

- `.mdx`, because the manual inbox only accepts `.md`; MDX is supported only by
  the repo-backed source synchronization path today
- `.markdown`, `.txt`, `.json`, `.jsonl`, `.csv`, `.html`, and `.xml`
- PDF, DOC, DOCX, RTF, EPUB, and presentation files
- images, audio, video, archives, and executable files
- extensionless files

Some of those formats are text-like or visible in the general artifact
explorer, but that does not mean the Knowledge promotion pipeline can ingest
them. PDF and office formats require text extraction, structured error handling,
and provenance for the derived Markdown before they can be offered here.

## Goals

- Add a clear Knowledge Inbox inside `/admin/memory`.
- Support file picker and drag-and-drop input for one or more `.md` files.
- Validate files on both browser and server boundaries.
- Derive useful metadata defaults while letting the operator review required
  descriptive fields.
- Submit through the existing `POST /knowledge/inbox` contract.
- Preserve source and upload provenance in Knowledge metadata.
- Show per-file queued, uploaded, rejected, and later indexed outcomes.
- Keep Prism Memory write keys and internal URLs out of browser JavaScript.
- Leave processing to the existing `knowledge-run` pipeline.

## Non-Goals

- Do not upload arbitrary binary documents in the first slice.
- Do not add PDF, DOCX, HTML, MDX, OCR, or media conversion.
- Do not write uploaded documents directly into canonical `knowledge/kb/docs`.
- Do not send these documents through `POST /memory/inbox`.
- Do not replace GitHub-backed Knowledge sources with manual file uploads.
- Do not automatically create a Knowledge source from an uploaded directory.
- Do not run an LLM to rewrite, summarize, classify, or approve the document in
  the first slice.
- Do not grant the browser a Prism Memory read, write, or ops API key.
- Do not silently replace an existing canonical document with the same slug.
- Do not add editing or canonical-document deletion in this slice.

## UI Placement

Add an `Inbox` tab to `MemoryExplorerWorkspace`:

```text
Artifacts | Sources | Inbox | Objectives | Chat
```

The tab label can remain short, but its heading should be `Knowledge Inbox`.
Place it next to Sources because both surfaces describe long-lived Knowledge.

The initial layout should have an upload area and an inbox status area:

```text
Knowledge Inbox

+-----------------------------------------------------------+
| Drop Markdown files here                                  |
| or choose files                                           |
|                                                           |
| Supported: .md (UTF-8)   Maximum: 5 MB each              |
+-----------------------------------------------------------+

Pending files
+-----------------------------------------------------------+
| ops-playbook.md       Ready             [Review] [Remove] |
| security-policy.pdf  Unsupported type                    |
+-----------------------------------------------------------+

Recent inbox activity
+-----------------------------------------------------------+
| Title             Slug          State       Submitted     |
| Ops Playbook      ops-playbook  Waiting     Jul 15 12:10 |
+-----------------------------------------------------------+
```

Drag-and-drop must be an enhancement, not the only input method. The drop zone
should be keyboard reachable and activate the native file picker on Enter or
Space.

## Upload And Review Flow

1. The operator selects or drops one or more files.
2. The browser rejects unsupported extensions and oversized or empty files
   before adding them to the queue.
3. For each valid file, the browser reads enough text to derive defaults.
4. The operator opens a compact review panel for that file.
5. The operator confirms metadata and selects `Add to Knowledge Inbox`.
6. The browser sends one multipart request per file to Site. Independent
   requests make partial batch failure and retry behavior clear.
7. Site validates the file and metadata again, generates provenance fields,
   and posts the JSON contract to Prism Memory.
8. A successful write appears as `Waiting for knowledge run`.
9. The existing `knowledge-run` task later promotes and indexes the document.
10. Refresh or polling changes the row to `Indexed`, with a link to the
    canonical document when available.

Submitting a batch should not be all-or-nothing. Files that succeed remain
queued even when another file fails. Retry only failed files.

Recommended first-slice batch limits:

- maximum 10 files per selection/drop
- maximum 5 MB per file by default
- maximum 25 MB for the full browser queue
- configurable server limit with `KNOWLEDGE_UPLOAD_MAX_MB`, clamped to a safe
  range

The server limit is authoritative. Do not reuse the request artifact upload
limit, because large arbitrary artifacts and Markdown Knowledge documents have
different risk and processing profiles.

## Metadata Defaults

Required fields should not force the operator to fill a large form for every
ordinary document. Derive safe defaults, then expose the important choices.

| Field | Default | Operator behavior |
| --- | --- | --- |
| `title` | First H1, otherwise filename without `.md` converted to words | Editable and required. |
| `slug` | Filesystem-safe kebab case from filename | Editable, required, and checked for duplicates. |
| `kind` | `reference` when allowed, otherwise the first configured kind | Select from instance-configured kinds. |
| `summary` | First non-heading paragraph, trimmed to a bounded preview | Editable and required. Do not use an LLM in v1. |
| `tags` | `knowledge` when allowed, otherwise empty | Multi-select only from instance-configured tags. |
| `owners` | `admin-upload` | Editable and required until Prism has a stable signed-in member identity. |
| `status` | `draft` | Fixed in v1. |
| `audience` | `internal` | Fixed in v1 to avoid accidental public classification. |
| `stability` | `evolving` | Fixed in v1. |
| `updated` | Upload time in UTC | Generated server-side. |
| `entities` | `[]` | Hidden advanced field or empty in v1. |
| `related_docs` | `[]` | Hidden advanced field or empty in v1. |
| `triaged_at` | Upload time in UTC | Generated server-side. |

Site should load allowed kinds and tags from Prism Memory rather than hard-code
the starter lists. `GET /config/status` already returns
`knowledge_allowed_kinds` and `knowledge_allowed_tags`; expose only those safe
fields through an admin-session proxy route.

If Knowledge metadata validation is disabled or no kinds are available, disable
submission and show the configuration error. Do not guess a kind that the
instance will later reject.

## Provenance

Site should add server-owned metadata that cannot be overridden by form fields:

```json
{
  "source_system": "prism-site",
  "source_type": "admin_knowledge_upload",
  "source_id": "<server-generated-ingest-id>",
  "original_filename": "ops-playbook.md",
  "content_sha256": "<sha256>",
  "size_bytes": 4812,
  "uploaded_at": "2026-07-15T18:00:00Z"
}
```

Do not claim an individual uploader identity while the surface is protected only
by the shared admin session. If member authentication is present later, add the
stable user id and display name as separate provenance fields.

The generated ingest id should survive promotion in the metadata sidecar so the
UI can correlate an incoming file with its canonical document.

## Admin API

Add browser/admin-session routes under the existing Memory Explorer boundary:

```http
GET /admin/memory/api/knowledge/inbox/config
GET /admin/memory/api/knowledge/inbox?status=incoming&limit=50
POST /admin/memory/api/knowledge/inbox
```

`GET .../config` should return a sanitized shape:

```json
{
  "enabled": true,
  "allowedExtensions": [".md"],
  "maxFileBytes": 5242880,
  "maxBatchFiles": 10,
  "allowedKinds": ["architecture", "guide", "policy", "proposal", "reference", "note"],
  "allowedTags": ["general", "knowledge", "operations"],
  "defaults": {
    "kind": "reference",
    "status": "draft",
    "audience": "internal",
    "stability": "evolving"
  }
}
```

`POST .../inbox` should accept multipart form data with one file and its reviewed
metadata. A representative shape is:

```text
file=<File>
title=Ops Playbook
slug=ops-playbook
kind=guide
summary=How to run core guild operations.
tags=["knowledge","operations"]
owners=["ops-team"]
```

Site should:

1. require the existing admin session;
2. enforce request and file byte limits before decoding;
3. require a `.md` basename and sanitize it using the same allowed filename
   characters as Prism Memory;
4. reject empty files, NUL bytes, invalid UTF-8, and invalid metadata JSON;
5. normalize a UTF-8 byte-order mark and line endings without rewriting the
   document body otherwise;
6. verify kind and tags against the live allowlists;
7. set fixed lifecycle fields and server-owned provenance;
8. compute SHA-256 for audit and duplicate diagnostics;
9. post `{ filename, content, metadata }` to Prism Memory
   `POST /knowledge/inbox`;
10. map Prism Memory validation errors to useful 4xx browser responses;
11. return the ingest id, inbox path, metadata path, warnings, and current
    lifecycle state.

Suggested success response:

```json
{
  "ok": true,
  "item": {
    "ingestId": "uuid",
    "filename": "ops-playbook.md",
    "slug": "ops-playbook",
    "state": "incoming",
    "path": "knowledge/kb/triage/inbox/ops-playbook.md",
    "metadataPath": "knowledge/kb/triage/inbox/ops-playbook.meta.json",
    "warnings": []
  }
}
```

Do not send `x-service-token` to these `/admin/*` routes. They are browser admin
routes and should use the existing admin session.

## Prism Memory API Use

Site should prefer:

```text
PRISM_API_WRITE_KEY
```

and fall back to the legacy combined key:

```text
PRISM_API_KEY
```

The server sends the selected key to Prism Memory as `X-Prism-Api-Key`.
`PRISM_API_READ_KEY` must not be used for upload. The key and Prism Memory base
URL remain server-side.

The first slice can reuse existing Prism Memory routes:

- `POST /knowledge/inbox` for writes
- `GET /config/status` for allowed kinds and tags
- `GET /api/artifacts?category=knowledge&status=incoming&type=knowledge_inbox`
  for a basic pending list
- `GET /knowledge/docs/{slug}` to resolve a canonical document after indexing

The general artifact API lists metadata sidecars separately. The Inbox UI must
filter `type=knowledge_inbox` so operators see one row per Markdown candidate,
not a second row for each `.meta.json` file.

A later dedicated Prism Memory `GET /knowledge/inbox` endpoint may be useful if
the UI needs paired sidecars, per-item validation errors, cursor pagination, or
direct ingest-id lifecycle lookups. Do not build a Site-owned shadow database
only to compensate for that missing read model.

## Duplicate And Replacement Safety

The current write path rejects an existing inbox filename, but filename checks
alone are insufficient. Two different inbox filenames can declare the same
slug, and promotion currently writes to the canonical kind/slug path.

Before release, strengthen the write boundary so a new manual inbox item is
rejected with `409 Conflict` when any of these match:

- an existing incoming item filename
- an existing incoming item slug
- an existing canonical Knowledge document slug
- an existing ingest id

Return a stable error code such as `knowledge_duplicate` with the matching slug
and state. Do not append a timestamp or silently create `slug-2`, because that
would obscure document identity.

Replacing or versioning a canonical document needs a separate explicit workflow
with review, diff, and provenance. It is out of scope for this upload slice.

Hash equality can improve the duplicate message but should not be the primary
identity rule. The same content may legitimately appear in differently scoped
documents, while the same slug must never be silently overwritten.

## Lifecycle And Inbox Status

Use operator-facing states that map to the current filesystem pipeline:

| UI state | Prism state | Meaning |
| --- | --- | --- |
| `Validating` | browser/Site only | File and metadata checks are running. |
| `Waiting` | Knowledge artifact `incoming` | The document and sidecar are in triage inbox. |
| `Indexed` | canonical Knowledge doc `processed` | Promotion and index rebuild completed. |
| `Needs attention` | still incoming or `rejected` with an error | Processing did not accept the item. |
| `Upload failed` | no inbox record | The Site or Prism Memory write failed. |

The existing promotion command leaves invalid items in the triage inbox and
reports errors in command output. That is not enough for a helpful Inbox UI.
The first implementation should do all currently expressible metadata
validation before writing so ordinary invalid items never enter the queue.

For durable processing diagnostics, add a follow-up pipeline change that records
an error beside the candidate or moves the document and sidecar together to a
rejected directory. The UI should never infer failure only from age; a delayed or
disabled task is different from a rejected document.

The Inbox should show whether the `knowledge-run` built-in task exists and is
enabled. If it is disabled, show:

```text
Uploads will remain in the inbox until the Prism knowledge run task is enabled.
[Open Tasks]
```

Do not call `/ops/knowledge/run` with the Site write key. A future `Process now`
button should invoke the existing admin task-run route so the task runner keeps
run history and uses its ops credential boundary.

## Error Handling

Use per-file errors and preserve the file in the browser queue when retry is
safe.

Recommended mappings:

| Condition | Status | UI message |
| --- | --- | --- |
| Unsupported extension | `400` | Only UTF-8 Markdown (`.md`) files are supported. |
| Empty file | `400` | This Markdown file is empty. |
| Invalid UTF-8 or binary content | `400` | This file is not valid UTF-8 Markdown. |
| File too large | `413` | File exceeds the configured Knowledge upload limit. |
| Invalid metadata | `400` | Show field-level Prism validation messages. |
| Duplicate filename or slug | `409` | A pending or indexed document already uses this slug. |
| Missing write key | `503` | Knowledge upload is not configured on Site. |
| Prism Memory unavailable | `502` or `503` | Prism Memory could not be reached; retry is safe. |
| Unexpected upstream response | `502` | Upload status is unknown; refresh the inbox before retrying. |

If Site times out after sending the upstream request, refresh by ingest id or
slug before retrying. This avoids turning an ambiguous response into a duplicate
submission.

## Security And Privacy

- Require the same admin session used by the Memory Explorer.
- Enforce size, count, extension, filename, metadata, and UTF-8 validation on
  the server even when the browser already validated them.
- Treat MIME type as advisory.
- Use `Path(filename).name` semantics and the existing safe Knowledge filename
  pattern to prevent traversal.
- Never render uploaded Markdown as unsanitized HTML in the review preview.
- Display Markdown as escaped text or through the same sanitized renderer used
  by Knowledge views.
- Do not follow URLs, resolve remote images, execute code fences, or evaluate
  MDX while uploading.
- Do not log document bodies, API keys, or complete multipart requests.
- Log only ingest id, filename, slug, byte count, hash prefix, outcome, duration,
  and safe upstream error codes.
- Default new documents to internal audience and draft status.
- Preserve the original document only in Prism Memory; do not create a second
  durable Site copy.

Markdown can contain sensitive text even when it is technically valid. The UI
should remind operators that upload makes the document available to Prism
Knowledge retrieval after indexing.

## Accessibility And Interaction Details

- File selection, removal, review, submit, and retry must work by keyboard.
- Announce validation and upload results through an `aria-live` region.
- Do not encode state only by color; include text and icons.
- Keep focus on the failed file or its first invalid field after submission.
- Confirm before navigating away while valid files are still uploading.
- Do not show a destructive confirmation when removing a file that has not yet
  been submitted.
- Once an item is successfully queued, removing it from the local list must not
  imply that the server-side inbox item was deleted.

## Observability

Add structured Site logs for:

- `knowledge_upload.accepted`
- `knowledge_upload.rejected`
- `knowledge_upload.upstream_failed`
- `knowledge_upload.duplicate`

Include:

- ingest id
- sanitized filename
- slug
- size in bytes
- hash prefix
- validation or upstream error code
- Prism Memory response status
- request duration

Use existing task run history for promotion/index diagnostics. Do not add a
second scheduler status store in the Memory Explorer.

## Implementation Plan

### Slice 1: Safe Markdown Inbox

- [ ] Add a server-side Prism Memory write helper that prefers
  `PRISM_API_WRITE_KEY` and falls back to `PRISM_API_KEY`.
- [ ] Add the sanitized Knowledge upload config proxy.
- [ ] Add the admin multipart upload route.
- [ ] Add strict `.md`, byte-size, filename, UTF-8, and metadata validation.
- [ ] Add server-generated ingest id, SHA-256, and upload provenance.
- [ ] Strengthen duplicate slug checks at the Prism Memory write boundary.
- [ ] Add the `Inbox` tab, accessible drop zone, native picker, and per-file
  review form.
- [ ] Support up to 10 independently submitted files per batch.
- [ ] Show pending Knowledge inbox documents without metadata sidecar rows.
- [ ] Show whether the existing `knowledge-run` task is enabled and link to
  Tasks when it is disabled.
- [ ] Poll or refresh pending items and link to the canonical Knowledge view
  after indexing.
- [ ] Update Memory Explorer user documentation.

### Slice 2: Review And Diagnostics

- [ ] Add a dedicated paired Knowledge inbox read model if the artifact API is
  insufficient.
- [ ] Persist per-item promotion errors and expose them to the admin UI.
- [ ] Add explicit retry after metadata correction.
- [ ] Add a task-runner-backed `Process now` action with task run history.
- [ ] Add an explicit remove/reject action with audit records.

### Slice 3: Conversion And Replacement

- [ ] Evaluate plain text, PDF, DOCX, HTML, and MDX conversion to derived
  Markdown.
- [ ] Store extractor name/version and original-file hash in provenance.
- [ ] Add preview and operator approval before a derived document enters the
  inbox.
- [ ] Design canonical replacement/versioning with diff and rollback.
- [ ] Consider folder upload only after per-file metadata and partial failure
  behavior are proven.

## Testing

### Unit And Route Tests

- Accept a valid UTF-8 `.md` file with browser MIME types `text/markdown`,
  `text/plain`, empty, and `application/octet-stream`.
- Reject a non-`.md` filename even when its MIME type says `text/markdown`.
- Reject `.mdx`, `.txt`, `.pdf`, `.docx`, `.json`, extensionless, empty,
  oversized, NUL-containing, and invalid UTF-8 files.
- Reject traversal filenames and normalize safe basenames.
- Derive title, slug, and deterministic summary defaults.
- Reject unknown kinds and tags from the active instance config.
- Ensure browser-supplied provenance cannot override server-owned fields.
- Confirm upload uses the write key and never the read or ops key.
- Map empty content, invalid metadata, file exists, duplicate slug, auth, and
  upstream availability errors.
- Confirm document bodies and credentials are absent from logs.

### Integration Tests

- Upload a Markdown document through Site and verify the `.md` and `.meta.json`
  files appear together in the Prism Knowledge triage inbox.
- Run `knowledge-run` and verify the document is promoted, validated, indexed,
  searchable, and linked from the Inbox UI.
- Verify the ingest id and upload provenance survive promotion.
- Upload a batch with mixed success and retry only failed items.
- Verify two concurrent submissions cannot claim the same slug.
- Verify an existing canonical slug cannot be silently overwritten.
- Verify a disabled `knowledge-run` task leaves the item in a truthful Waiting
  state and the UI explains why.
- Verify an unavailable Prism Memory instance produces a retryable error without
  storing a Site-side orphan.

### UI And Accessibility Tests

- Select files with the native picker and keyboard-operated drop zone.
- Drop supported and unsupported files together.
- Review and edit required metadata for each queued file.
- Confirm focus and live announcements on validation and upload errors.
- Confirm responsive behavior with long filenames, long summaries, and 10-file
  batches.
- Confirm Markdown containing HTML or scripts is never executed in preview.

## Rollout And Existing Instances

The feature requires the Site service to have:

```text
PRISM_MEMORY_BASE_URL=http://<reachable-prism-memory>
PRISM_API_WRITE_KEY=<write-scoped-key>
```

Older combined-key instances can use `PRISM_API_KEY` as the fallback. The
existing read-only Memory Explorer still prefers `PRISM_API_READ_KEY`.

Before enabling the UI:

1. confirm Prism Memory exposes `POST /knowledge/inbox` and `GET /config/status`;
2. confirm Site has a write-capable key;
3. confirm only one knowledge scheduler is active;
4. enable the built-in `knowledge-run` task or document the legacy cron;
5. run one upload through promotion and Knowledge search;
6. confirm duplicate slug rejection before allowing broad operator use.

Gate the UI behind a server-reported `enabled` value. If write configuration is
missing, keep the existing read-only Memory Explorer usable and show a focused
setup message only inside the Inbox tab.

## Open Questions

- Should `owners` stay an editable free-form list until member authentication is
  universal, or should instances configure a default Knowledge owner?
- Should the first release expose tags, entities, and related docs as advanced
  fields, or keep entities and related docs empty until after upload?
- Is a dedicated `GET /knowledge/inbox` read model worth adding in Slice 1 to
  provide reliable ingest-id lifecycle state, or is the filtered artifact API
  sufficient for initial validation?
- Should `Process now` ship in Slice 2, or is linking to the existing Tasks page
  enough for operator testing?
- When canonical replacement is designed, should it create a reviewed version
  history in Prism Memory or route through a Prism request workflow?
