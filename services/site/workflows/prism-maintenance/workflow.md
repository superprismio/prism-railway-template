# Prism Maintenance

Repair workflow/configuration drift and apply evidence-backed, behavior-preserving
optimizations. Assessment is a discovery phase, not a blanket approval gate.
Independent safe repairs proceed even when other findings require operator input;
verification owns the final unresolved-items decision. Doctor remains report-only
until an operator dispatches maintenance. Approved scheduled sweeps and Doctor
findings enter this same workflow. Legacy workflow-repair-loop requests retain
their history but new sweeps use prism-maintenance.

Own instance configuration diagnosis, bounded repair and verification without requiring a repository, PR or code-review gate. Doctor creates an unstarted request; detecting findings is not authorization to mutate the instance. Explicit operator dispatch authorizes the scoped maintenance work, not blanket permission to eliminate every warning.

Dreamer is the explicit executor, not an Admin fallback. Keep source reports,
decisions and receipts as request artifacts. Preserve historical runs and custom
configuration. Code, credentials, access policy, business decisions, destructive
operations and external publishing need separate authority. Never create a CR
merely because a credential, skill or configuration route is missing.

Memory work is recommendation-only: inspect relevant evidence and propose
improvements with provenance. Do not rewrite, delete, rebuild, reclassify or
promote memory. Do not change Dreamer's own authority, bindings or schedules.
