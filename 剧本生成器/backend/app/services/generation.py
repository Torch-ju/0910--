import asyncio
import time

from sqlalchemy import func, select

from app.db import Message, Project, Proposal, Run, RunEvent, StoryDraft, row
from app.errors import AppError

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted", "stale"}


def add_event(s, run, kind, payload):
    seq = s.scalar(select(func.max(RunEvent.seq)).where(RunEvent.run_id == run.id)) or 0
    s.add(RunEvent(run_id=run.id, seq=seq + 1, type=kind, payload=payload))


def fail(s, run, code, message, status="failed"):
    run.status = status
    run.error = {"code": code, "message": message}
    add_event(s, run, "error", {"error": run.error})


class Runner:
    def __init__(self, db, gateway, settings):
        self.db, self.gateway, self.settings = db, gateway, settings
        self.tasks = {}

    def recover(self):
        with self.db.transaction() as s:
            for run in s.scalars(select(Run).where(Run.status.in_(["queued", "running"]))):
                fail(
                    s,
                    run,
                    "RUN_INTERRUPTED",
                    "上次生成因服务中断而停止，输入已保存，可重新发送。",
                    "interrupted",
                )

    def start(self, rid):
        task = asyncio.create_task(self.execute(rid))
        self.tasks[rid] = task
        task.add_done_callback(lambda _: self.tasks.pop(rid, None))

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def reserve(self, rid):
        with self.db.transaction() as s:
            run = s.get(Run, rid)
            if run.status != "running":
                raise AppError("RUN_CANCELLED", "生成已停止。")
            consumed = s.scalar(select(func.sum(Run.attempts))) or 0
            if self.settings.model_call_budget <= consumed:
                raise AppError("BUDGET_EXHAUSTED", "已到真实模型调用次数上限，请检查后端预算设置。", 429)
            run.attempts += 1

    async def execute(self, rid):
        started = time.monotonic()
        try:
            with self.db.transaction() as s:
                run = s.get(Run, rid)
                if run.status != "queued":
                    return
                run.status = "running"
                context = run.context
            if context.get("_task") == "compose" and self.settings.model_provider != "mock":
                from app.services.novel import write_novel

                output, usage = await write_novel(self, rid, context)
            else:
                output, usage = await self.gateway.generate(context, lambda: self.reserve(rid))
            with self.db.transaction() as s:
                run = s.get(Run, rid)
                if run.status != "running":
                    return
                run.usage = usage
                run.elapsed_ms = int((time.monotonic() - started) * 1000)
                p = s.get(Project, run.project_id)
                stale = p.revision != run.input_revision or p.agent_revision != run.context.get(
                    "_agent_revision", p.agent_revision
                )
                if run.task_kind == "compose":
                    from app.services.agent_memory import validate_composition

                    validate_composition(output, run.context)
                    skill = run.context["skill"]
                    story = StoryDraft(
                        project_id=p.id,
                        run_id=run.id,
                        title=output.title,
                        synopsis=output.synopsis,
                        chapters=[c.model_dump() for c in output.chapters],
                        connections=[c.model_dump() for c in output.connections],
                        node_versions={n["id"]: n["version"] for n in run.context["nodes"]},
                        artifact_revision=run.input_revision,
                        agent_revision=run.context["_agent_revision"],
                        skill_name=skill["name"],
                        skill_hash=skill["hash"],
                        assumptions=output.assumptions,
                        status="stale" if stale else "draft",
                        mode="mock" if run.model == "mock" else "real",
                    )
                    s.add(story)
                    s.flush()
                    message = Message(
                        project_id=p.id,
                        role="assistant",
                        content=(
                            "故事依据已经变化，保留了过期草稿。"
                            if stale
                            else "已通过创作技能连接确认节点，故事草稿可以在「故事 Agent」中查看。新增情节已单独列出，等待你审阅。"
                        ),
                    )
                    s.add(message)
                    s.flush()
                    run.result = {
                        "run_id": run.id,
                        "message": row(message),
                        "proposals": [],
                        "project_revision": p.revision,
                        "story_id": story.id,
                    }
                    if stale:
                        fail(s, run, "CONTEXT_CHANGED", "节点或设定已变化，请重新连接故事。", "stale")
                    else:
                        run.status = "succeeded"
                        add_event(s, run, "done", run.result)
                    return
                content = output.reply
                if output.questions:
                    content += "\n\n" + "\n".join(output.questions)
                if stale:
                    content = "【依据已变化，以下是过期草稿，不能直接采用】\n\n" + content
                m = Message(project_id=p.id, role="assistant", content=content)
                s.add(m)
                s.flush()
                from app.services.agent_memory import record_memories

                node_ids = record_memories(s, p, run, m, output, stale)
                if output.questions and run.context.get("guided_question"):
                    from app.services.guidance import progress, question

                    next_id = getattr(output, "next_question_id", None)
                    target = (
                        question(next_id)
                        if next_id
                        else next((step for step in progress(s, p.id)["steps"] if not step["answer"]), None)
                    )
                    if target:
                        rcontext = {
                            **run.context,
                            "next_guided_question": {**target, "question": output.questions[0]},
                            "guidance_revision": p.agent_revision,
                        }
                        run.context = rcontext
                proposals = []
                for i, item in enumerate(output.proposals):
                    q = Proposal(
                        project_id=p.id,
                        message_id=m.id,
                        **item.model_dump(),
                        ordinal=i + 1,
                        base_revision=run.input_revision,
                        status="stale" if stale else "pending",
                    )
                    s.add(q)
                    s.flush()
                    proposals.append(row(q))
                run.result = {
                    "run_id": rid,
                    "message": row(m),
                    "proposals": proposals,
                    "project_revision": p.revision,
                    "node_ids": node_ids,
                    "quality_notes": ["问题数量超过两条"] if len(output.questions) > 2 else [],
                }
                if stale:
                    fail(
                        s,
                        run,
                        "CONTEXT_CHANGED",
                        "生成时资料发生了变化，旧草稿已保留，请基于最新设定重新生成。",
                        "stale",
                    )
                else:
                    run.status = "succeeded"
                    add_event(s, run, "done", run.result)
        except asyncio.CancelledError:
            with self.db.transaction() as s:
                run = s.get(Run, rid)
                if run.status not in TERMINAL:
                    fail(s, run, "RUN_INTERRUPTED", "生成已中断，输入已保存。", "interrupted")
        except Exception as error:
            public = (
                error
                if isinstance(error, AppError)
                else AppError("GENERATION_FAILED", "生成失败，输入已保存，请重试。", 500)
            )
            with self.db.transaction() as s:
                run = s.get(Run, rid)
                if run.status not in TERMINAL:
                    run.elapsed_ms = int((time.monotonic() - started) * 1000)
                    fail(s, run, public.code, public.message)
