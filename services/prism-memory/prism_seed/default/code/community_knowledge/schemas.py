from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from community_memory.config_loader import KnowledgeConstraints


REQUIRED_FIELDS = [
    "title",
    "slug",
    "kind",
    "summary",
    "tags",
    "owners",
    "status",
    "audience",
    "stability",
    "updated",
    "entities",
    "related_docs",
    "triaged_at",
]


@dataclass
class ValidationResult:
    errors: List[str]
    warnings: List[str]

    @property
    def ok(self) -> bool:
        return not self.errors


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def validate_metadata(
    metadata: Dict[str, Any],
    *,
    constraints: KnowledgeConstraints,
    allowed_kinds: list[str],
) -> ValidationResult:
    errors: List[str] = []
    warnings: List[str] = []

    for field in REQUIRED_FIELDS:
        if field not in metadata:
            errors.append(f"missing required field '{field}'")

    kind = str(metadata.get("kind", "")).strip()
    if kind and kind not in allowed_kinds:
        errors.append(f"invalid kind '{kind}' (allowed: {', '.join(allowed_kinds)})")

    status = str(metadata.get("status", "")).strip()
    if status and status not in constraints.allowed_status:
        errors.append(
            f"invalid status '{status}' (allowed: {', '.join(constraints.allowed_status)})"
        )

    audience = str(metadata.get("audience", "")).strip()
    if audience and audience not in constraints.allowed_audiences:
        errors.append(
            "invalid audience "
            f"'{audience}' (allowed: {', '.join(constraints.allowed_audiences)})"
        )

    stability = str(metadata.get("stability", "")).strip()
    if stability and stability not in constraints.allowed_stability:
        errors.append(
            "invalid stability "
            f"'{stability}' (allowed: {', '.join(constraints.allowed_stability)})"
        )

    tags = _as_str_list(metadata.get("tags"))
    if len(tags) > constraints.max_tags_per_doc:
        errors.append(
            f"too many tags ({len(tags)} > {constraints.max_tags_per_doc})"
        )
    if constraints.allowed_tags:
        unknown_tags = sorted({tag for tag in tags if tag not in constraints.allowed_tags})
        if unknown_tags:
            message = f"unknown tags: {', '.join(unknown_tags)}"
            if constraints.strict_tag_enforcement:
                errors.append(message)
            else:
                warnings.append(message)

    owners = _as_str_list(metadata.get("owners"))
    if constraints.require_owner and not owners:
        errors.append("owners must include at least one value")

    entities = _as_str_list(metadata.get("entities"))
    if len(entities) > constraints.max_entities_per_doc:
        errors.append(
            f"too many entities ({len(entities)} > {constraints.max_entities_per_doc})"
        )

    related_docs = _as_str_list(metadata.get("related_docs"))
    if len(related_docs) > constraints.max_related_docs_per_doc:
        errors.append(
            "too many related_docs "
            f"({len(related_docs)} > {constraints.max_related_docs_per_doc})"
        )

    return ValidationResult(errors=errors, warnings=warnings)

