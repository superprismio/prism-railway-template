# Changelog

Notable changes to the Prism Railway Template are recorded here. The canonical
update source is `superprismio/prism-railway-template` on `main`.

## Unreleased

### Added

- Template version and canonical repository metadata in `services/site/prism-version.json`.
- Admin and local CLI notifications when the canonical stable version or build
  is newer than the running instance.
- Prism build metadata in the Site health response.

### Fixed

- Keep the version manifest inside Site's Railway build root.
- Retry transient runtime job transport failures without creating duplicate
  jobs, and record actionable Site and Discord adapter diagnostics.
- Allow Discord adapter requests to wait beyond Node's five-minute response
  headers timeout when the configured runtime timeout is longer.

## 0.1.0

- Initial versioned Prism Railway Template baseline.
