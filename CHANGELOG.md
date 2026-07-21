# Changelog

Notable changes to the Prism Railway Template are recorded here. The canonical
update source is `superprismio/prism-railway-template` on `main`.

## Unreleased

### Changed

- Upgrade the reproducibly pinned Codex CLI from `0.139.0` to `0.144.6` after
  verifying the upstream headless image-generation persistence fix on the
  production Linux runtime.

### Added

- Template version and canonical repository metadata in `services/site/prism-version.json`.
- Admin and local CLI notifications when the canonical stable version or build
  is newer than the running instance.
- Prism build metadata in the Site health response.

### Fixed

- Keep the version manifest inside Site's Railway build root.
- Retry transient runtime job transport failures without creating duplicate
  jobs, and record actionable Site and Discord adapter diagnostics.

## 0.1.0

- Initial versioned Prism Railway Template baseline.
