"""Site-only retrieval boundary, separate from legacy broad read credentials."""
import os
import secrets
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from community_memory.retrieval import CatalogReader, RetrievalError
from .retrieval_routes import Search, Context, Filters


class Scope(BaseModel):
    model_config = ConfigDict(extra='forbid')
    buckets: list[str] = Field(max_length=100)
    knowledge_source_ids: list[str] = Field(default_factory=list, max_length=100)


class RequestBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: Literal['search', 'context', 'meetings', 'meeting', 'coverage']
    scope: Scope
    arguments: dict = Field(default_factory=dict)


class Meetings(Filters):
    limit: int = Field(default=20, ge=1, le=100)


class Meeting(BaseModel):
    model_config = ConfigDict(extra='forbid')
    meeting_id: str = Field(pattern=r'^[0-9a-f]{64}$')


def scoped_retrieval_router(root: Path) -> APIRouter:
    def site_auth(x_prism_retrieval_key: str | None = Header(None)):
        expected = os.getenv('PRISM_RETRIEVAL_SERVICE_KEY', '').strip()
        if not expected:
            raise HTTPException(503, 'Scoped retrieval is not configured')
        if not x_prism_retrieval_key or not secrets.compare_digest(expected, x_prism_retrieval_key):
            raise HTTPException(401, 'Unauthorized')

    router = APIRouter(dependencies=[Depends(site_auth)], tags=['scoped-retrieval'])

    @router.post('/retrieval/scoped')
    def retrieve(payload: RequestBody):
        source = os.getenv('PRISM_SHADOW_SOURCE_ROOT', '').strip()
        if not source:
            raise HTTPException(503, 'Source authority root is not configured')
        reader = CatalogReader(root, allowed_buckets=frozenset(payload.scope.buckets), source_root=Path(source))
        try:
            if payload.operation == 'coverage':
                if payload.arguments:
                    raise RetrievalError('coverage takes no arguments')
                generation, records = reader.snapshot()
                result = {'generation': generation, **reader.coverage(records)}
            else:
                schema = {'search': Search, 'context': Context, 'meetings': Meetings, 'meeting': Meeting}[payload.operation]
                arguments = schema.model_validate(payload.arguments).model_dump()
                result = getattr(reader, payload.operation)(**arguments)
            coverage = result if payload.operation == 'coverage' else result.get('coverage')
            if coverage is not None:
                coverage['limitations'] = [
                    'Retained inbox snapshot only; knowledge sources are not indexed.',
                    'Current retained files and deny policy are checked; upstream platform deletions and permissions require synchronization.',
                ]
            # Do not provide links to legacy unscoped artifact endpoints or disk paths.
            def sanitize(value):
                if isinstance(value, dict):
                    return {k: sanitize(v) for k, v in value.items() if k not in {'source_refs', 'source_url', 'metadata'}}
                if isinstance(value, list):
                    return [sanitize(v) for v in value]
                return value
            return {**sanitize(result), 'scope_enforcement': 'site-profile',
                    'knowledge_supported': False, 'visibility': 'current-retained-files-and-deny-policy'}
        except ValidationError:
            raise HTTPException(422, 'Invalid retrieval arguments')
        except RetrievalError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    return router
