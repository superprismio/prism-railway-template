from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from .activity import ActivityLogger
from .utils import b64encode


@dataclass
class GitHubEnv:
    owner: str
    repo: str
    token: str
    branch: str
    root_path: str

    @classmethod
    def from_env(cls, default_root: str) -> "GitHubEnv":
        missing = [key for key in ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_TOKEN"] if key not in os.environ]
        if missing:
            raise RuntimeError(f"Missing GitHub env vars: {', '.join(missing)}")
        return cls(
            owner=os.environ["GITHUB_OWNER"],
            repo=os.environ["GITHUB_REPO"],
            token=os.environ["GITHUB_TOKEN"],
            branch=os.environ.get("GITHUB_BRANCH", "main"),
            root_path=os.environ.get("GITHUB_ROOT_PATH", default_root).rstrip("/") + "/",
        )


class GitHubBackup:
    CODE_SUFFIXES = {".py", ".md", ".json"}

    def __init__(
        self,
        base_path: Path,
        env: GitHubEnv,
        activity: ActivityLogger,
        extra_paths: Optional[List[Tuple[Path, Path]]] = None,
    ) -> None:
        self.base_path = base_path
        self.env = env
        self.activity = activity
        self.extra_paths = extra_paths or []

    def run(self) -> List[str]:
        files = self._collect_files()
        uploaded: List[str] = []
        for local_path, relative_path in files:
            remote_path = f"{self.env.root_path}{relative_path}"
            self._upload_file(local_path, remote_path, relative_path)
            uploaded.append(remote_path)

        if uploaded:
            self.activity.log(
                "github.backup.completed",
                outputs=uploaded,
            )
        return uploaded

    def _collect_files(self) -> List[Tuple[Path, str]]:
        items: List[Tuple[Path, str]] = []
        memory_dir = self.base_path / "memory" / "rolling"
        if memory_dir.exists():
            for memory_file in sorted(memory_dir.glob("*")):
                if memory_file.suffix not in {".md", ".json"}:
                    continue
                items.append((memory_file, str(memory_file.relative_to(self.base_path))))
        for digest_md in self.base_path.glob("buckets/*/digests/*.md"):
            items.append((digest_md, str(digest_md.relative_to(self.base_path))))
        for digest_json in self.base_path.glob("buckets/*/digests/*.json"):
            items.append((digest_json, str(digest_json.relative_to(self.base_path))))
        for suggestion in self.base_path.glob("products/suggestions/*.md"):
            items.append((suggestion, str(suggestion.relative_to(self.base_path))))
        for suggestion_json in self.base_path.glob("products/suggestions/*.json"):
            items.append((suggestion_json, str(suggestion_json.relative_to(self.base_path))))
        misc_paths = [
            self.base_path / "activity" / "activity.jsonl",
            self.base_path / "state" / "collector_state.json",
            self.base_path / "config" / "space.json",
        ]
        for path in misc_paths:
            if path.exists():
                items.append((path, str(path.relative_to(self.base_path))))

        for local_path, remote_prefix in self.extra_paths:
            if local_path.is_dir():
                for file in local_path.rglob("*"):
                    if not file.is_file():
                        continue
                    if file.suffix and file.suffix not in self.CODE_SUFFIXES:
                        continue
                    rel = file.relative_to(local_path)
                    items.append((file, (remote_prefix / rel).as_posix()))
            elif local_path.is_file():
                items.append((local_path, str(remote_prefix)))

        # deduplicate by remote path, keeping latest local path reference
        seen = {}
        for local_path, rel in items:
            seen[rel] = local_path
        return sorted([(path, rel) for rel, path in seen.items()], key=lambda x: x[1])

    def _upload_file(self, local_path: Path, remote_path: str, relative_path: str) -> None:
        content = local_path.read_bytes()
        sha = self._get_sha(remote_path)
        payload = {
            "message": f"Update {relative_path}",
            "content": b64encode(content),
            "branch": self.env.branch,
        }
        if sha:
            payload["sha"] = sha
        url = f"https://api.github.com/repos/{self.env.owner}/{self.env.repo}/contents/{remote_path}"
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.env.token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        request = Request(url, data=body, headers=headers, method="PUT")
        try:
            with urlopen(request, timeout=30):
                return
        except HTTPError as exc:
            raise RuntimeError(
                f"GitHub upload failed for {relative_path}: {exc.code} {exc.read().decode('utf-8', errors='ignore')}"
            ) from exc

    def _get_sha(self, remote_path: str) -> str | None:
        url = f"https://api.github.com/repos/{self.env.owner}/{self.env.repo}/contents/{remote_path}?ref={self.env.branch}"
        headers = {
            "Authorization": f"Bearer {self.env.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        request = Request(url, headers=headers, method="GET")
        try:
            with urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8")).get("sha")
        except HTTPError as exc:
            if exc.code == 404:
                return None
            raise
