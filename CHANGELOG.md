# Changelog

Notable changes to the Prism Railway Template are recorded here. The canonical
update source is `superprismio/prism-railway-template` on `main`.

## Unreleased

### Added

- Deterministic recording-hook artifact preparation with an optional,
  idempotent child-request handoff to an instance-owned post-recording workflow.
- Template version and canonical repository metadata in `services/site/prism-version.json`.
- Admin and local CLI notifications when the canonical stable version or build
  is newer than the running instance.
- Prism build metadata in the Site health response.

### Fixed

- Avoid the Codex synthesis step when recording sources already provide the
  standard summary, while keeping raw transcripts private by default.
- Normalize public Prism Memory artifact URLs and reject internal service URLs
  from downstream recording artifacts.
- Keep the version manifest inside Site's Railway build root.
- Retry transient runtime job transport failures without creating duplicate
  jobs, and record actionable Site and Discord adapter diagnostics.

## 0.1.0

- Initial versioned Prism Railway Template baseline.
