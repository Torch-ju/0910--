from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Kind = Literal["story_seed", "character_note", "world_note", "project_brief", "open_question"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NewProject(Strict):
    title: str = Field(min_length=1, max_length=80)


class Turn(Strict):
    question_id: str | None = Field(default=None, max_length=40)
    text: str = Field(min_length=1, max_length=12000)
    client_request_id: str = Field(min_length=1, max_length=100)
    base_revision: int = Field(ge=0)
    lane: Literal["auto", "main", "auxiliary"] = "auto"


class DecisionInput(Strict):
    action: Literal["accept", "reject", "withdraw", "restore"]
    target_id: str = Field(min_length=1, max_length=100)
    base_revision: int = Field(ge=0)
    request_id: str = Field(min_length=1, max_length=100)


class EditArtifact(Strict):
    title: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=12000)
    kind: Kind = "character_note"
    base_version: int = Field(ge=0)
    base_revision: int = Field(ge=0)
    request_id: str = Field(min_length=1, max_length=100)


class Suggestion(Strict):
    kind: Kind
    title: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=4000)
    rationale: str = Field(max_length=1500)


class GuideTurn(Strict):
    reply: str = Field(min_length=1, max_length=12000)
    # Count compliance is a quality observation, not a reason to pay for repeated retries.
    questions: list[str] = Field(default_factory=list, max_length=20)
    proposals: list[Suggestion] = Field(default_factory=list, max_length=8)


class ErrorInfo(Strict):
    code: str
    message: str


class ErrorResponse(Strict):
    error: ErrorInfo
