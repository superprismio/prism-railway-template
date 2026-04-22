# Prism Reader Endpoints

Base URL:

```text
https://<prism-memory-domain>
```

Auth header:

```text
X-Prism-Api-Key: <read-key>
```

Examples:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/memory/latest"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/state/latest"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/search?q=discord&limit=10"
```

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/knowledge/docs/raidguild-handbook-home"
```

List recent memory inbox artifacts:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/api/artifacts?source=discord-voice&limit=10"
```

List processed knowledge artifacts:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/api/artifacts?category=knowledge&status=processed&limit=10"
```

Fetch one artifact as JSON:

```bash
curl -H "X-Prism-Api-Key: $PRISM_API_READ_KEY" \
  "$PRISM_API_BASE/api/artifacts/<artifact-id>"
```

Human-readable artifact pages are available at:

```text
$PRISM_API_BASE/artifacts/<artifact-id>
```
