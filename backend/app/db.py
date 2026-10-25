"""SQLite persistence: video projects, their edit iterations, and coaching sessions."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, Session, SQLModel, create_engine

from .config import settings


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = "Untitled pitch"
    goal: str = ""
    audience: str = ""
    style: str = ""
    format: str = "short"
    status: str = "draft"  # draft | moments | rendering | done | error
    source_path: str = ""
    source_file_uri: str = ""  # Gemini Files API URI of the source footage
    reference_paths: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    transcript: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    moments: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    selected_moments: list[int] = Field(default_factory=list, sa_column=Column(JSON))
    source_duration: Optional[float] = None
    created_at: datetime = Field(default_factory=_now)


class Iteration(SQLModel, table=True):
    """One rendered version of a project's video (v1 draft, v2 revision, v3+ human feedback)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    version: int
    trigger: str = "draft"  # draft | critique | human
    script: str = ""
    rationale: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    change_summary: str = ""
    changes: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    feedback: str = ""  # the presenter's chat message that produced this version (human revisions)
    duration: Optional[float] = None
    diff: str = ""
    video_path: str = ""
    critique: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    score: Optional[float] = None
    error: str = ""
    created_at: datetime = Field(default_factory=_now)


class CoachSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = "Rehearsal"
    recording_path: str = ""
    feedback_log: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    metrics: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    report: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_now)


engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Tiny forward-only migration: add columns that models gained since the DB was created."""
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            have = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info('{table.name}')")}
            for col in table.columns:
                if col.name not in have:
                    ddl_type = col.type.compile(dialect=engine.dialect)
                    conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}')


def get_session():
    with Session(engine) as session:
        yield session
