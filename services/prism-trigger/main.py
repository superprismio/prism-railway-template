import json
import os
import time
import sys
import urllib.error
import urllib.request


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    if truthy(os.environ.get("PRISM_TRIGGER_DISABLED")):
        print(json.dumps({"ok": True, "status": "disabled"}))
        return 0

    base = os.environ.get("PRISM_API_BASE", "").rstrip("/")
    path = os.environ.get("PRISM_TRIGGER_PATH", "/ops/memory/run")
    auth_header = os.environ.get("PRISM_TRIGGER_AUTH_HEADER", "X-Prism-Api-Key").strip() or "X-Prism-Api-Key"
    auth_token = os.environ.get("PRISM_TRIGGER_AUTH_TOKEN", "").strip() or os.environ.get("PRISM_API_KEY", "")
    raw_body = os.environ.get("PRISM_TRIGGER_BODY", "{}")
    max_attempts = max(1, int(os.environ.get("PRISM_TRIGGER_RETRY_ATTEMPTS", "6")))
    retry_delay_seconds = max(0.0, float(os.environ.get("PRISM_TRIGGER_RETRY_DELAY_SECONDS", "5")))

    if not base:
        print("PRISM_API_BASE is required", file=sys.stderr)
        return 1

    url = f"{base}{path}"
    headers = {
        "Content-Type": "application/json",
    }
    if auth_token:
        headers[auth_header] = auth_token

    request = urllib.request.Request(
        url,
        method="POST",
        headers=headers,
        data=raw_body.encode("utf-8"),
    )

    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            with urllib.request.urlopen(request) as response:
                body = response.read().decode("utf-8")
                print(
                    json.dumps(
                        {
                            "attempt": attempt,
                            "status": response.status,
                            "url": url,
                            "body": body,
                        }
                    )
                )
                return 0
        except urllib.error.URLError as error:
            last_error = error
            reason = getattr(error, "reason", error)
            print(
                json.dumps(
                    {
                        "attempt": attempt,
                        "url": url,
                        "error": str(reason) or error.__class__.__name__,
                    }
                ),
                file=sys.stderr,
            )
            if attempt >= max_attempts:
                break
            time.sleep(retry_delay_seconds)

    if last_error is not None:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "url": url,
                    "attempts": max_attempts,
                    "error": str(getattr(last_error, "reason", last_error)) or last_error.__class__.__name__,
                }
            ),
            file=sys.stderr,
        )
        return 1

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
