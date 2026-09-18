"""Opt-in trusted-reader preview. Do not expose to scoped public interfaces."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from community_memory.retrieval import CatalogReader, RetrievalError


class Filters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source: str | None = None
    kind: str | None = None
    participant: str | None = None
    start: str | None = None
    end: str | None = None
    meeting_id: str | None = None


class Search(Filters):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=100)


class Context(BaseModel):
    model_config = ConfigDict(extra='forbid')
    generation: str = Field(pattern=r'^[0-9a-f]{64}$')
    record_id: str = Field(pattern=r'^[0-9a-f]{64}$')
    revision: str = Field(pattern=r'^[0-9a-f]{64}$')
    passage_id: str = Field(pattern=r'^\d+$')
    max_chars: int = Field(default=8000, ge=1, le=32000)


def retrieval_router(root: Path, auth) -> APIRouter:
    router = APIRouter(dependencies=[Depends(auth)], tags=['experimental-retrieval'])
    reader = CatalogReader(root)

    def call(fn, **kwargs):
        try:
            return fn(**kwargs)
        except RetrievalError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    @router.get('/meetings')
    def meetings(source: str | None = None, participant: str | None = None,
                 start: str | None = None, end: str | None = None,
                 limit: int = Query(20, ge=1, le=100)):
        return call(reader.meetings, source=source, participant=participant, start=start, end=end, limit=limit)

    @router.get('/meetings/{meeting_id}')
    def meeting(meeting_id: str):
        return call(reader.meeting, meeting_id=meeting_id)

    @router.post('/retrieval/search')
    def search(payload: Search):
        return call(reader.search, **payload.model_dump())

    @router.post('/retrieval/context')
    def context(payload: Context):
        return call(reader.context, **payload.model_dump())

    @router.get('/retrieval/coverage')
    def coverage():
        def read():
            generation, records = reader.snapshot()
            return {'generation': generation, **reader.coverage(records)}
        return call(read)

    return router
