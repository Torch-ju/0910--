from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String)
    focus: Mapped[str] = mapped_column(String, default="故事种子")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    agent_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("messages.id"))
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="pending")
    base_revision: Mapped[int] = mapped_column(Integer)
    ordinal: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(default=True)


class ArtifactVersion(Base):
    __tablename__ = "artifact_versions"
    __table_args__ = (UniqueConstraint("artifact_id", "version"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Decision(Base):
    __tablename__ = "decisions"
    __table_args__ = (UniqueConstraint("project_id", "request_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    request_id: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    target_id: Mapped[str] = mapped_column(String)
    evidence: Mapped[str] = mapped_column(String)
    fingerprint: Mapped[str] = mapped_column(String)
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (UniqueConstraint("project_id", "request_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    request_id: Mapped[str] = mapped_column(String)
    message_id: Mapped[str] = mapped_column(ForeignKey("messages.id"))
    status: Mapped[str] = mapped_column(String, default="queued")
    input_revision: Mapped[int] = mapped_column(Integer)
    fingerprint: Mapped[str] = mapped_column(String)
    context: Mapped[dict] = mapped_column(JSON)
    model: Mapped[str] = mapped_column(String)
    prompt_version: Mapped[str] = mapped_column(String, default="guide_turn_v1")
    task_kind: Mapped[str] = mapped_column(String, default="guide", server_default="guide")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)


class RunEvent(Base):
    __tablename__ = "run_events"
    __table_args__ = (UniqueConstraint("run_id", "seq"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)


class StoryNode(Base):
    __tablename__ = "story_nodes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    source_message_id: Mapped[str] = mapped_column(ForeignKey("messages.id"))
    source_reply_id: Mapped[str] = mapped_column(ForeignKey("messages.id"))
    lane: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    summary: Mapped[str] = mapped_column(Text)
    source_quote: Mapped[str] = mapped_column(Text)
    next_step: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="draft")
    include_in_story: Mapped[bool] = mapped_column(default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String, default=now)


class NodeRevision(Base):
    __tablename__ = "node_revisions"
    __table_args__ = (UniqueConstraint("node_id", "version"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    node_id: Mapped[str] = mapped_column(ForeignKey("story_nodes.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)


class StoryDraft(Base):
    __tablename__ = "story_drafts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), unique=True)
    title: Mapped[str] = mapped_column(String)
    synopsis: Mapped[str] = mapped_column(Text)
    chapters: Mapped[list] = mapped_column(JSON)
    connections: Mapped[list] = mapped_column(JSON)
    node_versions: Mapped[dict] = mapped_column(JSON)
    artifact_revision: Mapped[int] = mapped_column(Integer)
    agent_revision: Mapped[int] = mapped_column(Integer)
    skill_name: Mapped[str] = mapped_column(String)
    skill_hash: Mapped[str] = mapped_column(String)
    assumptions: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String, default="draft")
    mode: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Database:
    def __init__(self, url):
        if url.startswith("sqlite:///") and ":memory:" not in url:
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        options = {"connect_args": {"check_same_thread": False}}
        if ":memory:" in url:
            options["poolclass"] = StaticPool
        self.engine = create_engine(url, **options)
        self.lock = RLock()

        @event.listens_for(self.engine, "connect")
        def configure(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=5000")

    @contextmanager
    def transaction(self):
        with self.lock, Session(self.engine, expire_on_commit=False) as session:
            with session.begin():
                yield session


def row(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
