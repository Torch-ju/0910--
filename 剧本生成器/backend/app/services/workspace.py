import hashlib
import json
import re

from sqlalchemy import select

from app.db import Artifact, ArtifactVersion, Decision, Message, Project, Proposal, Run, now, row
from app.errors import AppError


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def get_project(s, pid):
    p = s.get(Project, pid)
    if not p:
        raise AppError("NOT_FOUND", "这个项目不存在。", 404)
    return p


def check_revision(p, revision):
    if p.revision != revision:
        raise AppError("VERSION_CONFLICT", "资料已更新，请查看最新版本后重试。", 409)


def changed(s, p):
    from app.services.agent_memory import invalidate_stories

    invalidate_stories(s, p.id)
    p.revision += 1
    p.updated_at = now()
    # Changes invalidate all other unaccepted suggestions; no hidden rebasing.
    for item in s.scalars(select(Proposal).where(Proposal.project_id == p.id, Proposal.status == "pending")):
        item.status = "stale"


def artifacts(s, pid, include_withdrawn=True):
    out = []
    for a in s.scalars(select(Artifact).where(Artifact.project_id == pid)):
        if not include_withdrawn and not a.active:
            continue
        v = s.scalar(
            select(ArtifactVersion).where(
                ArtifactVersion.artifact_id == a.id, ArtifactVersion.version == a.current_version
            )
        )
        out.append({**row(v), "id": a.id, "active": a.active})
    return out


def snapshot(s, pid):
    p = get_project(s, pid)
    run = s.scalar(select(Run).where(Run.project_id == pid).order_by(Run.created_at.desc()))
    return {
        "project": row(p),
        "artifacts": artifacts(s, pid),
        "proposals": [
            row(x)
            for x in s.scalars(
                select(Proposal)
                .where(Proposal.project_id == pid)
                .order_by(Proposal.created_at, Proposal.ordinal)
            )
        ],
        "latest_run": public_run(run) if run else None,
    }


def public_run(run):
    return {
        k: getattr(run, k)
        for k in [
            "id",
            "project_id",
            "message_id",
            "status",
            "input_revision",
            "model",
            "prompt_version",
            "task_kind",
            "attempts",
            "result",
            "error",
            "usage",
            "elapsed_ms",
            "created_at",
        ]
    }


def existing_decision(s, pid, request_id, fp):
    d = s.scalar(select(Decision).where(Decision.project_id == pid, Decision.request_id == request_id))
    if d and d.fingerprint != fp:
        raise AppError("IDEMPOTENCY_CONFLICT", "该请求编号已用于其他操作，请刷新后重试。", 409)
    return d.result if d else None


def decide(s, pid, data, evidence="ui"):
    p = get_project(s, pid)
    fp = fingerprint(data.model_dump())
    prior = existing_decision(s, pid, data.request_id, fp)
    if prior:
        return prior
    check_revision(p, data.base_revision)
    target = data.target_id
    aid = None
    if data.action in ("accept", "reject"):
        q = s.get(Proposal, target)
        if not q or q.project_id != pid:
            raise AppError("NOT_FOUND", "这条建议不属于当前项目。", 404)
        if q.status != "pending" or q.base_revision != p.revision:
            raise AppError("PROPOSAL_STALE", "这条建议已处理或依据已变化，请重新讨论。", 409)
        q.status = "accepted" if data.action == "accept" else "rejected"
        if data.action == "accept":
            a = Artifact(project_id=pid)
            s.add(a)
            s.flush()
            aid = a.id
            s.add(
                ArtifactVersion(
                    artifact_id=aid,
                    version=1,
                    title=q.title,
                    kind=q.kind,
                    content=q.content,
                    source="proposal:" + q.id,
                )
            )
            changed(s, p)
        else:
            changed(s, p)
    else:
        a = s.get(Artifact, target)
        if not a or a.project_id != pid:
            raise AppError("NOT_FOUND", "这条资料不属于当前项目。", 404)
        if a.active == (data.action == "restore"):
            raise AppError("ALREADY_APPLIED", "这条资料已处于目标状态。", 409)
        a.active = data.action == "restore"
        aid = a.id
        changed(s, p)
    s.flush()
    result = {"project_revision": p.revision, "artifact_id": aid, "action": data.action}
    s.add(
        Decision(
            project_id=pid,
            request_id=data.request_id,
            action=data.action,
            target_id=target,
            evidence=evidence,
            fingerprint=fp,
            result=result,
        )
    )
    return result


def edit(s, pid, aid, data, evidence="ui"):
    p = get_project(s, pid)
    fp = fingerprint({**data.model_dump(), "artifact_id": aid})
    prior = existing_decision(s, pid, data.request_id, fp)
    if prior:
        return prior
    check_revision(p, data.base_revision)
    if aid:
        a = s.get(Artifact, aid)
        if not a or a.project_id != pid:
            raise AppError("NOT_FOUND", "这条资料不属于当前项目。", 404)
        if a.current_version != data.base_version:
            raise AppError("VERSION_CONFLICT", "资料版本已变化，请重新打开编辑。", 409)
        a.current_version += 1
        a.active = True
    else:
        if data.base_version != 0:
            raise AppError("VERSION_CONFLICT", "新资料的初始版本必须为零。", 409)
        a = Artifact(project_id=pid)
        s.add(a)
        s.flush()
    s.add(
        ArtifactVersion(
            artifact_id=a.id,
            version=a.current_version,
            title=data.title,
            kind=data.kind,
            content=data.content,
            source=evidence,
        )
    )
    changed(s, p)
    s.flush()
    result = {"artifact_id": a.id, "version": a.current_version, "project_revision": p.revision}
    s.add(
        Decision(
            project_id=pid,
            request_id=data.request_id,
            action="edit",
            target_id=a.id,
            evidence=evidence,
            fingerprint=fp,
            result=result,
        )
    )
    return result


def resolve_choice(s, pid, text):
    # Only full-message explicit commands qualify; quoted/negated/compound text cannot match.
    text = text.strip().rstrip("。！!")
    match = re.fullmatch(r"(?:用|采用|选择)(?:第)?([一二三四五六七八12345678])个", text)
    singular = text in ("就这个", "就用这个", "采用这个")
    if not match and not singular:
        return None
    last = s.scalar(
        select(Proposal)
        .where(Proposal.project_id == pid, Proposal.status == "pending")
        .order_by(Proposal.created_at.desc())
    )
    if not last:
        return None
    qs = list(
        s.scalars(
            select(Proposal)
            .where(
                Proposal.project_id == pid,
                Proposal.message_id == last.message_id,
                Proposal.status == "pending",
            )
            .order_by(Proposal.ordinal)
        )
    )
    if singular:
        return qs[0] if len(qs) == 1 else None
    token = match[1]
    index = int(token) if token.isdigit() else "一二三四五六七八".index(token) + 1
    return next((q for q in qs if q.ordinal == index), None)


def build_context(s, p, text, budget):
    from app.services.agent_memory import memory_view
    from app.services.guidance import progress
    from app.services.skill_loader import story_skill

    facts = artifacts(s, p.id, False)
    confirmed = [{"title": x["title"], "content": x["content"], "version": x["version"]} for x in facts]
    recent = list(
        s.scalars(
            select(Message).where(Message.project_id == p.id).order_by(Message.created_at.desc()).limit(12)
        )
    )[::-1]
    context = {
        "interview": progress(s, p.id),
        "_task": "agent",
        "_agent_revision": p.agent_revision,
        "memory": memory_view(s, p.id),
        "skill": story_skill(),
        "text": text,
        "revision": p.revision,
        "artifacts": confirmed,
        "history": [],
        "proposals": [
            {"title": x.title, "status": x.status, "content": x.content}
            for x in s.scalars(
                select(Proposal)
                .where(Proposal.project_id == p.id)
                .order_by(Proposal.created_at.desc())
                .limit(6)
            )
        ],
    }

    # Conservative UTF-8-byte budget (upper bound for byte-based tokenizers), not a fake exact token count.
    def size(value):
        return len(json.dumps(value, ensure_ascii=False).encode())

    limit = max(1000, budget - 2000)
    if size(context) > limit:
        raise AppError("CONTEXT_LIMIT", "已确认资料超过本阶段上下文容量，请提高后端预算或缩小项目范围。", 422)
    for m in reversed(recent):
        entry = {"role": m.role, "content": m.content}
        proposed = {**context, "history": [entry] + context["history"]}
        if size(proposed) > limit:
            break
        context = proposed
    return context
