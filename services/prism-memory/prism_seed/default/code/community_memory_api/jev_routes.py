"""Ops-only handoff to a Gateway-leased JEV worker. No provider secrets here."""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from community_memory.jev_annotations import JevAnnotations
from community_memory.retrieval import RetrievalError


class Pending(BaseModel):
    model_config = ConfigDict(extra='forbid')
    limit: int = Field(default=2, ge=1, le=2)


class Result(BaseModel):
    model_config = ConfigDict(extra='forbid')
    record_id: str = Field(pattern=r'^[0-9a-f]{64}$')
    revision: str = Field(pattern=r'^[0-9a-f]{64}$')
    annotation_id: str = Field(pattern=r'^[0-9a-f]{64}$')
    response: dict


def jev_router(catalog: Path, source: Path, auth):
    router = APIRouter(prefix='/ops/annotations/jev', dependencies=[Depends(auth)], tags=['ops'])
    store = JevAnnotations(catalog, source)

    def call(fn, **kwargs):
        try:
            return fn(**kwargs)
        except RetrievalError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.post('/pending')
    def pending(body: Pending):
        return call(store.pending, **body.model_dump())

    @router.post('/results')
    def commit(body: Result):
        return call(store.commit, **body.model_dump())

    return router
