import asyncio
import json
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy import select

from app.config import Settings
from app.db import Artifact, ArtifactVersion, Database, Message, Project, Run, RunEvent, row
from app.errors import AppError
from app.responses import (
    Cancelled,
    DecisionResult,
    EditResult,
    HealthView,
    MessageList,
    ProjectCreated,
    ProjectList,
    RunView,
    TurnCreated,
    Versions,
    WorkspaceView,
)
from app.schemas import DecisionInput, EditArtifact, NewProject, Turn
from app.services.generation import TERMINAL, Runner, add_event, fail
from app.services.model_gateway import Gateway
from app.services.workspace import (
    artifacts,
    build_context,
    check_revision,
    decide,
    edit,
    fingerprint,
    get_project,
    public_run,
    resolve_choice,
    snapshot,
)


def create_app(settings=None, db=None, gateway=None):
    cfg = settings or Settings()
    db = db or Database(cfg.database_url)
    runner = Runner(db, gateway or Gateway(cfg), cfg)

    @asynccontextmanager
    async def lifespan(app):
        # Tables are created through Alembic, never a hidden create_all on production startup.
        runner.recover()
        yield
        await runner.close()

    app = FastAPI(title="留白 · 写作陪伴", lifespan=lifespan)
    app.state.db, app.state.runner = db, runner
    from app.agent_api import router as agent_router

    app.include_router(agent_router(db, runner, cfg))
    from app.model_api import router as model_router

    app.include_router(model_router(cfg, db))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.origins,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type", "Last-Event-ID"],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def local_write_boundary(request, call_next):
        if request.method in ("POST", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin and origin not in cfg.origins:
                return JSONResponse(
                    {"error": {"code": "ORIGIN_DENIED", "message": "不允许来自此页面的写入。"}}, 403
                )
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"error": {"code": "ORIGIN_DENIED", "message": "不允许跨站写入。"}}, 403)
            if "application/json" not in request.headers.get("content-type", ""):
                return JSONResponse(
                    {"error": {"code": "INVALID_CONTENT_TYPE", "message": "请使用 JSON 请求。"}}, 415
                )
        return await call_next(request)

    @app.exception_handler(AppError)
    async def known_error(request, error):
        return JSONResponse(error.payload(), status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, error):
        return JSONResponse(
            {"error": {"code": "INVALID_INPUT", "message": "输入不符合要求，请检查长度、版本或必填内容。"}},
            422,
        )

    @app.exception_handler(Exception)
    async def unexpected(request, error):
        return JSONResponse(
            {"error": {"code": "INTERNAL_ERROR", "message": "保存或读取失败，请保留输入并重试。"}}, 500
        )

    @app.get("/api/v1/health", response_model=HealthView)
    def health():
        return {
            "status": "ok",
            "mode": "mock" if cfg.model_provider == "mock" else "real",
            "model_configured": bool(cfg.model_api_key and cfg.model_name and cfg.model_base_url),
            "streaming": "final_result",
            "stage": 2,
        }

    @app.get("/api/v1/model/status")
    def model_status():
        return {
            "provider": cfg.model_provider,
            "model": cfg.model_name,
            "configured": bool(cfg.model_api_key and cfg.model_name and cfg.model_base_url),
            "call_budget": cfg.model_call_budget,
        }

    @app.post("/api/v1/model/check")
    async def check_model():
        from app.services.deepseek import check_connection

        return await check_connection(cfg)

    @app.post("/api/v1/projects", status_code=201, response_model=ProjectCreated)
    def new_project(data: NewProject):
        with db.transaction() as s:
            p = Project(title=data.title)
            s.add(p)
            s.flush()
            return {"project": row(p)}

    @app.get("/api/v1/projects", response_model=ProjectList)
    def list_projects():
        with db.transaction() as s:
            return {"items": [row(p) for p in s.scalars(select(Project).order_by(Project.updated_at.desc()))]}

    @app.get("/api/v1/projects/{pid}", response_model=WorkspaceView)
    def project(pid: UUID):
        with db.transaction() as s:
            return snapshot(s, str(pid))

    @app.get("/api/v1/projects/{pid}/messages", response_model=MessageList)
    def messages(pid: UUID, before: str | None = None, limit: int = Query(default=100, ge=1, le=200)):
        with db.transaction() as s:
            get_project(s, str(pid))
            query = select(Message).where(Message.project_id == str(pid))
            if before:
                query = query.where(Message.created_at < before)
            found = list(s.scalars(query.order_by(Message.created_at.desc()).limit(limit + 1)))
            page = found[:limit]
            return {
                "items": [row(m) for m in page[::-1]],
                "next_cursor": page[-1].created_at if len(found) > limit else None,
            }

    @app.post("/api/v1/projects/{pid}/turns", status_code=202, response_model=TurnCreated)
    async def turn(pid: UUID, data: Turn):
        pid = str(pid)
        fp = fingerprint(
            {
                "text": data.text,
                "base_revision": data.base_revision,
                "lane": data.lane,
                "question_id": data.question_id,
            }
        )
        from app.services.guidance import question

        guided = question(data.question_id) if data.question_id else None
        if guided and data.lane == "auxiliary":
            raise AppError("LANE_MISMATCH", "回答引导问题时请选择主线，闲聊可切换自由对话。", 422)
        with db.transaction() as s:
            p = get_project(s, pid)
            prior = s.scalar(
                select(Run).where(Run.project_id == pid, Run.request_id == data.client_request_id)
            )
            if prior:
                if prior.fingerprint != fp:
                    raise AppError("IDEMPOTENCY_CONFLICT", "请求编号已用于另一条消息。", 409)
                return {"message_id": prior.message_id, "run_id": prior.id, "status": prior.status}
            check_revision(p, data.base_revision)
            if s.scalar(select(Run.id).where(Run.status.in_(["queued", "running"])).limit(1)):
                raise AppError("RUN_BUSY", "已有内容正在生成，请等待或停止后继续。", 409)
            if guided:
                from app.services.guidance import progress

                guided = next(q for q in progress(s, pid)["steps"] if q["id"] == guided["id"])
            # Resolve before adding the user's new message.
            choice = resolve_choice(s, pid, data.text) if data.lane != "auxiliary" and not guided else None
            m = Message(project_id=pid, role="user", content=data.text)
            s.add(m)
            s.flush()
            reply = None
            if choice:
                decide(
                    s,
                    pid,
                    DecisionInput(
                        action="accept",
                        target_id=choice.id,
                        base_revision=p.revision,
                        request_id="turn:" + data.client_request_id,
                    ),
                    evidence="message:" + m.id,
                )
                reply = f"已采用「{choice.title}」，并保存到故事资料。\n\n你想继续探索人物的目标，还是他将遇到的阻碍？"
            elif (
                data.lane != "auxiliary"
                and not guided
                and data.text.startswith(("设定：", "设定:"))
                and data.text[3:].strip()
            ):
                content = data.text[3:].strip()
                edit(
                    s,
                    pid,
                    None,
                    EditArtifact(
                        title="我的设定",
                        content=content,
                        kind="project_brief",
                        base_version=0,
                        base_revision=p.revision,
                        request_id="turn:" + data.client_request_id,
                    ),
                    evidence="message:" + m.id,
                )
            r = Run(
                project_id=pid,
                request_id=data.client_request_id,
                message_id=m.id,
                input_revision=p.revision,
                fingerprint=fp,
                context={"lane_hint": data.lane, "_agent_revision": p.agent_revision},
                prompt_version="agent_turn_v1",
                model="mock" if cfg.model_provider == "mock" else cfg.model_name,
            )
            s.add(r)
            s.flush()
            if reply:
                answer = Message(project_id=pid, role="assistant", content=reply)
                s.add(answer)
                s.flush()
                from app.agent_schemas import AgentTurn, MemorySegment
                from app.services.agent_memory import record_memories

                chosen_memory = AgentTurn(
                    reply=reply,
                    memories=[
                        MemorySegment(
                            lane="main",
                            category="plot",
                            title=choice.title,
                            summary="用户已采用：" + choice.content[:750],
                            source_quote=data.text,
                            next_step="继续探索主角面对的阻碍和下一次选择。",
                        )
                    ],
                )
                node_ids = record_memories(s, p, r, answer, chosen_memory, False)
                r.status = "succeeded"
                r.result = {
                    "node_ids": node_ids,
                    "run_id": r.id,
                    "message": row(answer),
                    "proposals": [],
                    "project_revision": p.revision,
                }
                add_event(s, r, "done", r.result)
            else:
                try:
                    r.context = {
                        **build_context(s, p, data.text, cfg.context_token_budget),
                        "lane_hint": "main" if guided else data.lane,
                        "guided_question": guided,
                    }
                except AppError as error:
                    fail(s, r, error.code, error.message)
            rid, status = r.id, r.status
        if status == "queued":
            runner.start(rid)
        return {"message_id": m.id, "run_id": rid, "status": status}

    @app.get("/api/v1/runs/{rid}", response_model=RunView)
    def run(rid: UUID):
        with db.transaction() as s:
            r = s.get(Run, str(rid))
            if not r:
                raise AppError("NOT_FOUND", "生成记录不存在。", 404)
            return public_run(r)

    @app.get("/api/v1/runs/{rid}/events")
    async def events(
        rid: UUID,
        request: Request,
        after_seq: int = Query(default=0, ge=0),
        last_event_id: str | None = Header(default=None),
    ):
        rid = str(rid)
        with db.transaction() as s:
            if not s.get(Run, rid):
                raise AppError("NOT_FOUND", "生成记录不存在。", 404)
        try:
            cursor = max(after_seq, int(last_event_id or 0))
        except ValueError:
            raise AppError("INVALID_CURSOR", "事件游标无效。", 422)

        async def stream():
            nonlocal cursor
            while not await request.is_disconnected():
                with db.transaction() as s:
                    batch = [
                        row(e)
                        for e in s.scalars(
                            select(RunEvent)
                            .where(RunEvent.run_id == rid, RunEvent.seq > cursor)
                            .order_by(RunEvent.seq)
                        )
                    ]
                    state = s.get(Run, rid).status
                for e in batch:
                    cursor = e["seq"]
                    yield f"id: {cursor}\nevent: {e['type']}\ndata: {json.dumps(e['payload'], ensure_ascii=False)}\n\n"
                if state in TERMINAL:
                    break
                yield ": waiting\n\n"
                await asyncio.sleep(0.3)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/v1/runs/{rid}/cancel", response_model=Cancelled)
    async def cancel(rid: UUID):
        rid = str(rid)
        with db.transaction() as s:
            r = s.get(Run, rid)
            if not r:
                raise AppError("NOT_FOUND", "生成记录不存在。", 404)
            if r.status not in TERMINAL:
                fail(s, r, "RUN_CANCELLED", "你已停止本次生成，输入已保留。", "cancelled")
            result = {"status": r.status}
        task = runner.tasks.get(rid)
        if task:
            task.cancel()
        return result

    @app.post("/api/v1/projects/{pid}/decisions", response_model=DecisionResult)
    def decision(pid: UUID, data: DecisionInput):
        with db.transaction() as s:
            return decide(s, str(pid), data)

    @app.post("/api/v1/projects/{pid}/artifacts", status_code=201, response_model=EditResult)
    def create_artifact(pid: UUID, data: EditArtifact):
        with db.transaction() as s:
            return edit(s, str(pid), None, data)

    @app.patch("/api/v1/projects/{pid}/artifacts/{aid}", response_model=EditResult)
    def edit_artifact(pid: UUID, aid: UUID, data: EditArtifact):
        with db.transaction() as s:
            return edit(s, str(pid), str(aid), data)

    @app.get("/api/v1/projects/{pid}/artifacts/{aid}/versions", response_model=Versions)
    def versions(pid: UUID, aid: UUID):
        with db.transaction() as s:
            a = s.get(Artifact, str(aid))
            if not a or a.project_id != str(pid):
                raise AppError("NOT_FOUND", "资料不存在。", 404)
            return {
                "items": [
                    row(v)
                    for v in s.scalars(
                        select(ArtifactVersion)
                        .where(ArtifactVersion.artifact_id == str(aid))
                        .order_by(ArtifactVersion.version.desc())
                    )
                ]
            }

    @app.get("/api/v1/projects/{pid}/export")
    def export(pid: UUID):
        with db.transaction() as s:
            data = snapshot(s, str(pid))
            lines = [
                "# " + data["project"]["title"],
                "",
                f"资料版本：{data['project']['revision']}",
                "",
                "## 已确认资料",
                "",
            ]
            for a in artifacts(s, str(pid), False):
                lines.extend(
                    ["### " + a["title"], a["content"], f"版本 {a['version']} · 来源 {a['source']}", ""]
                )
            lines += ["## 待定与过期建议（未采用）", ""]
            for q in data["proposals"]:
                if q["status"] in ("pending", "stale"):
                    lines.extend(
                        [
                            "### " + q["title"] + ("（过期）" if q["status"] == "stale" else "（待定）"),
                            q["content"],
                            "",
                        ]
                    )
            lines += ["", "阶段 1：本文件是已有故事资料，不代表完整小说。"]
        return Response(
            "\n".join(lines),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="story-notes.md"'},
        )

    return app


app = create_app()
