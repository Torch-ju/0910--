from typing import Literal

from pydantic import Field

from app.schemas import GuideTurn, Strict

Lane = Literal["main", "auxiliary"]
Category = Literal["protagonist", "world", "plot", "chat"]


class MemorySegment(Strict):
    lane: Lane
    category: Category
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=800)
    source_quote: str = Field(min_length=1, max_length=12000)
    next_step: str = Field(default="", max_length=400)


class AgentTurn(GuideTurn):
    next_question_id: str | None = Field(default=None, max_length=40)
    memories: list[MemorySegment] = Field(min_length=1, max_length=12)


class NodeEdit(Strict):
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=800)
    lane: Lane
    category: Category
    status: Literal["draft", "confirmed", "withdrawn"]
    include_in_story: bool = False
    base_version: int = Field(ge=1)
    request_id: str = Field(min_length=1, max_length=100)


class ComposeInput(Strict):
    use_summaries: bool = False
    request_id: str = Field(min_length=1, max_length=100)
    base_revision: int = Field(ge=0)
    agent_revision: int = Field(ge=0)


class Chapter(Strict):
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1)
    node_ids: list[str] = Field(min_length=1, max_length=100)


class Connection(Strict):
    source_id: str
    target_id: str
    relation: Literal["causes", "follows", "supports", "payoff"]
    reason: str = Field(min_length=1, max_length=500)


class Composition(Strict):
    title: str = Field(min_length=1, max_length=100)
    synopsis: str = Field(min_length=1, max_length=2000)
    chapters: list[Chapter] = Field(min_length=1)
    connections: list[Connection] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class PlannedChapter(Strict):
    title: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    events: list[str] = Field(min_length=1)
    node_ids: list[str] = Field(min_length=1)
    closes: list[str] = Field(default_factory=list)


class NovelPlan(Strict):
    title: str = Field(min_length=1)
    synopsis: str = Field(min_length=1)
    ending: str = Field(min_length=1)
    threads: list[str] = Field(min_length=1)
    chapters: list[PlannedChapter] = Field(min_length=2)
    connections: list[Connection] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class NovelPart(Strict):
    content: str = Field(min_length=1)
    summary: str = Field(min_length=1, max_length=4000)
    chapter_finished: bool
    closed_threads: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class NovelReview(Strict):
    complete: bool
    issues: list[str] = Field(default_factory=list)
    repair_chapters: list[int] = Field(default_factory=list)
    conclusion: str = Field(min_length=1)
