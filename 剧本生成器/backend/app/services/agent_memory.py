import re

from sqlalchemy import select

from app.agent_schemas import AgentTurn, Composition, MemorySegment
from app.db import Decision, Message, NodeRevision, StoryDraft, StoryNode, row
from app.errors import AppError
from app.services.skill_loader import story_skill
from app.services.workspace import existing_decision, fingerprint, get_project


def main_category(text):
    if any(w in text for w in ("主角", "主人公", "他想", "她想", "角色", "身世", "师父", "师傅")):
        return "protagonist"
    if any(w in text for w in ("世界", "规则", "门派", "朝代", "江湖", "内力", "武功")):
        return "world"
    return "plot"


def mock_memories(text, hint="auto"):
    parts = [p.strip() for p in re.split(r"[。；;\n]+", text) if p.strip()]
    out = []
    for part in parts[:12]:
        main = any(
            w in part
            for w in (
                "主角",
                "主人公",
                "世界",
                "故事",
                "没想法",
                "启发",
                "剧情",
                "结局",
                "设定",
                "师父",
                "师傅",
                "门派",
                "江湖",
                "他想",
                "她想",
                "武功",
            )
        )
        lane = hint if hint != "auto" else ("main" if main else "auxiliary")
        cat = main_category(part) if lane == "main" else "chat"
        out.append(
            MemorySegment(
                lane=lane,
                category=cat,
                title=part[:28],
                summary="用户表达：" + part[:760],
                source_quote=part,
                next_step="继续确认主角的目标、阻碍与选择后果。"
                if lane == "main"
                else "可启发剧情转折与人物反应，优先服务主线。",
            )
        )
    return out or [
        MemorySegment(
            lane="auxiliary", category="chat", title="本轮交流", summary=text[:760], source_quote=text
        )
    ]


def mock_agent(context, guide):
    q = context.get("guided_question")
    if q:
        following = next(
            (
                step
                for step in context.get("interview", {}).get("steps", [])
                if not step["answer"] and step["id"] != q["id"]
            ),
            None,
        )
        return AgentTurn(
            reply="已将这次问答整理成可修改的故事摘要。",
            questions=[following["question"]]
            if following
            else ["世界观和时间线已走完一轮。你想修改哪一处，或生成小说草稿？"],
            memories=[
                MemorySegment(
                    lane="main",
                    category=q["category"],
                    title=q["title"],
                    summary=("问题：" + q["question"] + "\n回答：" + context["text"])[:800],
                    source_quote=context["text"],
                    next_step=following["question"]
                    if following
                    else "检查时间因果与世界规则，然后生成小说。",
                )
            ],
        )
    memories = mock_memories(context["text"], context.get("lane_hint", "auto"))
    if all(m.lane == "auxiliary" for m in memories) and context["text"] not in (
        "都不错",
        "都挺好",
        "以后再说",
        "都可以",
    ):
        guide = guide.model_copy(
            update={
                "reply": "这部分先记为辅助灵感，可以影响剧情的情绪、转折或支线，故事仍以主角目标为主。",
                "questions": [],
                "proposals": [],
            }
        )
    return AgentTurn(**guide.model_dump(), memories=memories)


def memory_view(s, pid):
    nodes = list(
        s.scalars(select(StoryNode).where(StoryNode.project_id == pid).order_by(StoryNode.created_at))
    )
    valid = [n for n in nodes if n.status not in ("withdrawn", "stale")]
    main = [n for n in valid if n.lane == "main"]
    aux = [n for n in valid if n.lane == "auxiliary"]

    # Full summaries remain in nodes. The digest is a deterministic view, never a new fact source.
    def compact(items, count):
        return [
            {"id": n.id, "title": n.title, "summary": n.summary, "status": n.status, "next_step": n.next_step}
            for n in items[-count:]
        ]

    return {
        "main": compact(main, 8),
        "auxiliary": compact(aux, 4),
        "main_total": len(main),
        "auxiliary_total": len(aux),
        "archived_main": max(0, len(main) - 8),
        "archived_auxiliary": max(0, len(aux) - 4),
    }


def node_version(s, node):
    s.flush()
    s.add(NodeRevision(node_id=node.id, version=node.version, payload=row(node)))


def invalidate_stories(s, pid):
    for story in s.scalars(
        select(StoryDraft).where(StoryDraft.project_id == pid, StoryDraft.status == "draft")
    ):
        story.status = "stale"


def record_memories(s, p, run, reply, output, stale):
    user = s.get(Message, run.message_id)
    segments = getattr(output, "memories", [])
    hint = run.context.get("lane_hint", "auto")
    # Validate all grounding before any record is committed.
    for item in segments:
        if item.source_quote not in user.content:
            raise AppError("SUMMARY_SOURCE_INVALID", "摘要引用了本轮原文中不存在的内容，请重新整理。", 422)
        if hint != "auto" and item.lane != hint:
            raise AppError("LANE_MISMATCH", "摘要分类与用户指定的对话方向不一致，请重试。", 422)
        if (item.lane == "auxiliary") != (item.category == "chat"):
            raise AppError("LANE_MISMATCH", "摘要主辅线与类型不一致。", 422)
    ids = []
    for item in segments:
        node = StoryNode(
            project_id=p.id,
            run_id=run.id,
            source_message_id=user.id,
            source_reply_id=reply.id,
            **item.model_dump(),
            status="stale" if stale else "draft",
        )
        s.add(node)
        s.flush()
        node_version(s, node)
        ids.append(node.id)
    if ids:
        p.agent_revision += 1
    return ids


def edit_node(s, pid, nid, data):
    p = get_project(s, pid)
    fp = fingerprint({**data.model_dump(), "node_id": nid})
    prior = existing_decision(s, pid, data.request_id, fp)
    if prior:
        return prior
    node = s.get(StoryNode, nid)
    if not node or node.project_id != pid:
        raise AppError("NOT_FOUND", "节点不属于当前项目。", 404)
    if node.version != data.base_version:
        raise AppError("VERSION_CONFLICT", "节点已更新，请重新打开后再修改。", 409)
    if (data.lane == "auxiliary") != (data.category == "chat"):
        raise AppError("LANE_MISMATCH", "辅助节点使用闲聊类型，主线请选择主角、世界观或故事线。", 422)
    for name in ("title", "summary", "lane", "category", "status", "include_in_story"):
        setattr(node, name, getattr(data, name))
    node.version += 1
    p.agent_revision += 1
    node_version(s, node)
    invalidate_stories(s, pid)
    result = {"node_id": node.id, "version": node.version, "agent_revision": p.agent_revision}
    s.add(
        Decision(
            project_id=pid,
            request_id=data.request_id,
            action="node_edit",
            target_id=nid,
            evidence="ui",
            fingerprint=fp,
            result=result,
        )
    )
    return result


def compose_context(s, p, budget, use_summaries=False):
    from app.services.workspace import artifacts

    skill = story_skill()
    nodes = list(
        s.scalars(
            select(StoryNode)
            .where(
                StoryNode.project_id == p.id,
                StoryNode.status.in_(["confirmed", "draft"] if use_summaries else ["confirmed"]),
            )
            .order_by(StoryNode.created_at)
        )
    )
    chosen = [
        n for n in nodes if n.lane == "main" or n.include_in_story or (use_summaries and n.status == "draft")
    ]
    mains = [n for n in chosen if n.lane == "main"]
    if not mains or not any(n.category == "protagonist" for n in mains):
        raise AppError("PROTAGONIST_REQUIRED", "请先确认至少一个主角节点，再连接故事。", 422)
    if len(mains) < 2:
        raise AppError("MORE_NODES_REQUIRED", "请再确认一个世界观或故事线节点，才能连接成故事。", 422)
    facts = [{"title": a["title"], "content": a["content"]} for a in artifacts(s, p.id, False)]
    from app.services.guidance import progress

    interview = progress(s, p.id)
    selected_ids = {n.id for n in chosen}
    for step in interview["steps"]:
        if step["answer"] and step["answer"]["node_id"] not in selected_ids:
            step["answer"] = None
    ordered = {step["answer"]["node_id"]: step["order"] for step in interview["steps"] if step["answer"]}
    chosen.sort(key=lambda n: ordered.get(n.id, len(ordered) + 10))
    context = {
        "interview": interview,
        "_task": "compose",
        "_agent_revision": p.agent_revision,
        "text": "按已确认节点生成完整故事草稿",
        "project_title": p.title,
        "skill": skill,
        "artifacts": facts,
        "nodes": [
            {
                "id": n.id,
                "version": n.version,
                "lane": n.lane,
                "category": n.category,
                "title": n.title,
                "summary": n.summary,
                "status": n.status,
            }
            for n in chosen
        ],
    }
    import json

    if len(json.dumps(context, ensure_ascii=False).encode()) > max(1000, budget - 2500):
        raise AppError("CONTEXT_LIMIT", "选定节点超过本次生成容量，请先合并摘要或调整后端上下文预算。", 422)
    return context


def validate_composition(output, context):
    nodes = {n["id"]: n for n in context["nodes"]}
    mains = {key for key, n in nodes.items() if n["lane"] == "main"}
    used = {key for chapter in output.chapters for key in chapter.node_ids}
    if not used.issubset(nodes) or not mains.issubset(used):
        raise AppError(
            "STORY_COVERAGE_INVALID", "故事遗漏了主线节点或引用未知节点，没有保存为有效草稿。", 422
        )
    auxiliary = set(nodes) - mains
    supported = {e.source_id for e in output.connections if e.relation == "supports"}
    if not auxiliary.issubset(used) or not auxiliary.issubset(supported):
        raise AppError("STORY_AUXILIARY_MISSING", "选入的辅助灵感未体现在章节和连接中，请重新生成。", 422)
    directed = {nid: set() for nid in nodes}
    undirected = {nid: set() for nid in mains}
    seen = set()
    for link in output.connections:
        a, b = link.source_id, link.target_id
        if a not in nodes or b not in nodes or a == b or (a, b) in seen:
            raise AppError("STORY_LINK_INVALID", "故事节点连接无效。", 422)
        seen.add((a, b))
        if link.relation == "supports":
            if a in mains or b not in mains:
                raise AppError("STORY_LINK_INVALID", "辅助素材只能支持主线节点。", 422)
        elif a not in mains or b not in mains:
            raise AppError("STORY_LINK_INVALID", "主线因果不能由闲聊节点替代。", 422)
        else:
            undirected[a].add(b)
            undirected[b].add(a)
        directed[a].add(b)
    visited, visiting = set(), set()

    def visit(nid):
        if nid in visiting:
            raise AppError("STORY_CYCLE", "故事连接出现循环，请重新生成。", 422)
        if nid in visited:
            return
        visiting.add(nid)
        for child in directed[nid]:
            visit(child)
        visiting.remove(nid)
        visited.add(nid)

    for nid in nodes:
        visit(nid)
    connected, stack = set(), [next(iter(mains))]
    while stack:
        nid = stack.pop()
        if nid not in connected:
            connected.add(nid)
            stack.extend(undirected[nid] - connected)
    if connected != mains:
        raise AppError("STORY_DISCONNECTED", "主线节点没有连成完整故事，请重新生成。", 422)


def mock_composition(context):
    main = [n for n in context["nodes"] if n["lane"] == "main"]
    auxiliary = [n for n in context["nodes"] if n["lane"] == "auxiliary"]
    chapters = []
    for i, n in enumerate(main):
        opening = (
            "那天，主人公第一次意识到，自己不能再等下去。"
            if i == 0
            else "上一次的选择已有了后果。主人公带着疑问继续向前。"
        )
        ending = (
            "他终于作出了选择。旧日的困局留在身后，尚未说完的话，留给明日。"
            if i == len(main) - 1
            else "这件事并未结束，反而让下一步变得更加艰难。"
        )
        chapters.append(
            {
                "title": f"第{i + 1}节 · {n['title']}",
                "content": f"【模拟故事片段：仅用于测试连接，不代表真实创作质量】\n\n{opening}\n\n这一节围绕已确认内容展开：{n['summary']}\n\n{ending}",
                "node_ids": [n["id"]],
            }
        )
    edges = [
        {
            "source_id": a["id"],
            "target_id": b["id"],
            "relation": "follows",
            "reason": "按主角逐步面对问题的顺序承接（模拟连接）。",
        }
        for a, b in zip(main, main[1:])
    ]
    edges += [
        {
            "source_id": n["id"],
            "target_id": main[0]["id"],
            "relation": "supports",
            "reason": "用户选入的辅助素材，仅供主线参考。",
        }
        for n in auxiliary
    ]
    if auxiliary:
        chapters[0]["node_ids"] += [n["id"] for n in auxiliary]
        chapters[0]["content"] += (
            "\n\n【模拟辅助影响】这些灵感将用于调整人物反应或支线转折，主角目标保持优先："
            + "；".join(n["summary"] for n in auxiliary)
        )
    return Composition(
        title=context["project_title"] + " · 故事草稿",
        synopsis="围绕主角，把已确认主线节点依次连接为起因、行动与结果。",
        chapters=chapters,
        connections=edges,
        assumptions=["模拟模板中的过渡、主角作出选择及开放结尾均未获用户确认。"],
    )
