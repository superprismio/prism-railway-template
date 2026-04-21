# Prism Memory Service

Starter FastAPI service for:

- memory retrieval
- knowledge retrieval
- authenticated ops endpoints
- volume-backed runtime state

Recommended Railway settings:

- mount a persistent volume
- keep the service as the sole owner of that volume
- trigger background work through `/ops/*` from cron services
