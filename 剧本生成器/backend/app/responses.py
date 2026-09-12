from typing import Any, Literal

from pydantic import BaseModel

from app.schemas import ErrorInfo, Kind


class ProjectView(BaseModel):
    id: str
    title: str
    focus: str
    revision: int
    agent_revision: int
    created_at: str
    updated_at: str


class ProjectCreated(BaseModel):
    project: ProjectView


class ProjectList(BaseModel):
    items: list[ProjectView]


class MessageView(BaseModel):
    id: str
    project_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: str


class MessageList(BaseModel):
    items: list[MessageView]
    next_cursor: str | None


class ProposalView(BaseModel):
    id: str
    project_id: str
    message_id: str
    kind: Kind
    title: str
    content: str
    rationale: str
    status: Literal["pending", "accepted", "rejected", "stale"]
    base_revision: int
    ordinal: int
    created_at: str


class ArtifactView(BaseModel):
    id: str
    artifact_id: str
    title: str
    kind: Kind
    content: str
    version: int
    source: str
    created_at: str


class CurrentArtifact(ArtifactView):
    active: bool


class Versions(BaseModel):
    items: list[ArtifactView]


class GeneratedResult(BaseModel):
    run_id: str
    message: MessageView
    proposals: list[ProposalView]
    project_revision: int
    quality_notes: list[str] = []
    node_ids: list[str] = []
    story_id: str | None = None


RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled", "interrupted", "stale"]


class RunView(BaseModel):
    id: str
    project_id: str
    message_id: str
    status: RunStatus
    input_revision: int
    model: str
    prompt_version: str
    task_kind: Literal["guide", "compose"]
    attempts: int
    result: GeneratedResult | None
    error: ErrorInfo | None
    usage: dict[str, Any] | None
    elapsed_ms: int | None
    created_at: str


class WorkspaceView(BaseModel):
    project: ProjectView
    artifacts: list[CurrentArtifact]
    proposals: list[ProposalView]
    latest_run: RunView | None


class TurnCreated(BaseModel):
    message_id: str
    run_id: str
    status: RunStatus


class Cancelled(BaseModel):
    status: RunStatus


class DecisionResult(BaseModel):
    project_revision: int
    artifact_id: str | None
    action: Literal["accept", "reject", "withdraw", "restore"]


class EditResult(BaseModel):
    artifact_id: str
    version: int
    project_revision: int


class HealthView(BaseModel):
    status: Literal["ok"]
    mode: Literal["mock", "real"]
    model_configured: bool
    streaming: Literal["final_result"]
    stage: int
