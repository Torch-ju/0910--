"""Checkpointed plan → scene writing → closure review. No total word/chapters cap."""

import copy
import json
from pathlib import Path

from app.agent_schemas import Composition, NovelPart, NovelPlan, NovelReview
from app.db import Project, Run
from app.errors import AppError
from app.services.agent_memory import validate_composition
from app.services.skill_loader import story_skill

PROMPTS = Path(__file__).parent / "prompts"


async def write_novel(runner, rid, context):
    state = copy.deepcopy(context.get("novel_work", {"stage": "planning", "chapters": [], "calls": []}))
    skill = state.get("skill") or story_skill(full=True)
    state["skill"] = skill
    if skill["hash"] != context["skill"]["hash"]:
        raise AppError("SKILL_CHANGED", "创作 Skill 已变化，请重新生成以使用一致版本。", 409)
    base = {k: v for k, v in context.items() if k != "novel_work"}
    base["skill"] = skill

    def save():
        with runner.db.transaction() as session:
            run = session.get(Run, rid)
            if run.status != "running":
                raise AppError("RUN_CANCELLED", "写作已停止。", 409)
            project = session.get(Project, run.project_id)
            if project.revision != run.input_revision or project.agent_revision != context["_agent_revision"]:
                raise AppError("CONTEXT_CHANGED", "故事依据已变化，已写章节保留。请重新生成。", 409)
            run.context = {**run.context, "novel_work": copy.deepcopy(state)}
            run.usage = {"calls": state["calls"]}

    async def call(schema, prompt_name, payload):
        save()
        if len(json.dumps(payload, ensure_ascii=False).encode()) > runner.settings.novel_context_bytes:
            raise AppError(
                "CONTEXT_LIMIT",
                "当前写作上下文超出单次容量，已保存进度。请调整 NOVEL_CONTEXT_BYTES 后继续。",
                422,
            )
        result, usage = await runner.gateway.complete(
            payload, lambda: runner.reserve(rid), schema, (PROMPTS / prompt_name).read_text(), lambda: None
        )
        state["calls"].append(usage)
        return result

    if "plan" not in state:
        plan = await call(NovelPlan, "novel_plan_v1.md", {**base, "_task": "novel_plan"})
        preview = Composition(
            title=plan.title,
            synopsis=plan.synopsis,
            chapters=[
                {"title": c.title, "content": c.purpose, "node_ids": c.node_ids} for c in plan.chapters
            ],
            connections=plan.connections,
            assumptions=plan.assumptions,
        )
        validate_composition(preview, context)
        state["plan"] = plan.model_dump()
        save()
    plan = NovelPlan.model_validate(state["plan"])
    for revision_round in range(3):
        state["stage"] = "writing"
        for index, chapter in enumerate(plan.chapters):
            if len(state["chapters"]) <= index:
                state["chapters"].append(
                    {"title": chapter.title, "node_ids": chapter.node_ids, "parts": [], "finished": False}
                )
            current = state["chapters"][index]
            while not current["finished"]:
                state["chapter_index"] = index
                recent_summaries = [
                    {"chapter": n, "summary": part["summary"]}
                    for n, c in enumerate(state["chapters"])
                    for part in c["parts"]
                ]
                payload = {
                    **base,
                    "_task": "novel_write",
                    "plan": state["plan"],
                    "current_chapter": chapter.model_dump(),
                    "chapter_index": index,
                    "last_chapter": index == len(plan.chapters) - 1,
                    "previous_summaries": recent_summaries,
                    "current_tail": "\n\n".join(p["content"] for p in current["parts"])[-6000:],
                    "repair_notes": state.get("repair_notes", []),
                }
                part = await call(NovelPart, "novel_write_v1.md", payload)
                if any(
                    p["content"].strip() == part.content.strip()
                    for c in state["chapters"]
                    for p in c["parts"]
                ):
                    raise AppError("NOVEL_REPEATED", "模型重复了已有正文，已保留进度，请继续写作重试。", 422)
                if not set(part.closed_threads).issubset(plan.threads):
                    raise AppError("NOVEL_THREAD_INVALID", "模型返回未知线索，已保留进度，请继续写作。", 422)
                current["parts"].append(part.model_dump())
                current["finished"] = part.chapter_finished
                save()
            # Count visible characters, excluding whitespace and the chapter heading.
            section_text = "\n\n".join(p["content"] for p in current["parts"])
            for length_attempt in range(3):
                length = len("".join(section_text.split()))
                if 1000 <= length <= 1400:
                    break
                if length_attempt == 2:
                    raise AppError(
                        "SECTION_LENGTH_INVALID", "本节尚未调整到约1200字，已保存正文，可继续写作重试。", 422
                    )
                adjusted = await call(
                    NovelPart,
                    "novel_length_v1.md",
                    {
                        **base,
                        "_task": "novel_length",
                        "section": section_text,
                        "current_chapter": chapter.model_dump(),
                        "actual_length": length,
                        "closed_threads": list({t for p in current["parts"] for t in p["closed_threads"]}),
                    },
                )
                if not adjusted.chapter_finished or set(adjusted.closed_threads) != {
                    t for p in current["parts"] for t in p["closed_threads"]
                }:
                    raise AppError(
                        "SECTION_LENGTH_INVALID", "本节调整结果不完整，原文已保留，请继续写作。", 422
                    )
                section_text = adjusted.content
                if 1000 <= len("".join(section_text.split())) <= 1400:
                    state.setdefault("length_revision_history", []).append(copy.deepcopy(current))
                    adjusted.assumptions = list(
                        dict.fromkeys(
                            adjusted.assumptions + [a for p in current["parts"] for a in p["assumptions"]]
                        )
                    )
                    current["parts"] = [adjusted.model_dump()]
                    save()
        state["stage"] = "reviewing"
        ledger = [
            {
                "chapter": i,
                "title": c["title"],
                "parts": [
                    {"summary": p["summary"], "closed_threads": p["closed_threads"]} for p in c["parts"]
                ],
            }
            for i, c in enumerate(state["chapters"])
        ]
        review = await call(
            NovelReview,
            "novel_review_v1.md",
            {
                **base,
                "_task": "novel_review",
                "plan": state["plan"],
                "ledger": ledger,
                "ending_text": "\n\n".join(p["content"] for p in state["chapters"][-1]["parts"])[-12000:],
            },
        )
        state["review"] = review.model_dump()
        closed = {t for c in state["chapters"] for p in c["parts"] for t in p["closed_threads"]}
        missing = set(plan.threads) - closed
        if review.complete and not review.issues and not review.repair_chapters and not missing:
            state["stage"] = "complete"
            save()
            assumptions = list(
                dict.fromkeys(
                    plan.assumptions
                    + [a for c in state["chapters"] for p in c["parts"] for a in p["assumptions"]]
                )
            )
            output = Composition(
                title=plan.title,
                synopsis=plan.synopsis,
                chapters=[
                    {
                        "title": c["title"],
                        "content": "\n\n".join(p["content"] for p in c["parts"]),
                        "node_ids": c["node_ids"],
                    }
                    for c in state["chapters"]
                ],
                connections=plan.connections,
                assumptions=assumptions,
            )
            validate_composition(output, context)
            return output, {"calls": state["calls"], "completeness_review": review.model_dump()}
        state["repair_notes"] = review.issues + ["尚未收束：" + t for t in sorted(missing)]
        repairs = review.repair_chapters or [len(plan.chapters) - 1]
        if any(i < 0 or i >= len(plan.chapters) for i in repairs):
            save()
            raise AppError("NOVEL_REVIEW_INVALID", "审校给出了无效章节，已保留正文，请继续写作重试。", 422)
        # Rebuild the affected suffix to keep downstream continuity. Retain all old text for recovery.
        start = min(repairs)
        state.setdefault("revision_history", []).append(copy.deepcopy(state["chapters"][start:]))
        state["chapters"] = state["chapters"][:start]
        state["stage"] = "repairing"
        save()
        if revision_round == 2:
            raise AppError(
                "NOVEL_INCOMPLETE", "完整性检查尚未通过，已保留正文和修改意见。可继续写作完成修订。", 422
            )
    raise AssertionError("unreachable")
