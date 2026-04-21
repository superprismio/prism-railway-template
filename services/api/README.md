# API Service

Bootstrap and seed commands are now split by concern.

Recommended deploy-time order:

- `npm run migrate`
- `npm run bootstrap:admin`
- `npm run bootstrap:targets`

Optional:

- `npm run seed:catalog`
- `npm run seed:profiles -- /path/to/profiles.json`
- `npm run seed:demo`

Notes:

- `bootstrap:targets` reads `config/target-apps.default.json` by default.
- Set `TARGET_APPS_MANIFEST=/app/config/your-manifest.json` or pass a path argument to use another manifest.
- `seed:catalog` still depends on `docs/data/*`.
