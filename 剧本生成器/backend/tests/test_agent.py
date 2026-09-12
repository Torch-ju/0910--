from uuid import uuid4

import pytest

# Imported pytest fixtures are intentionally exposed in this module.
# ruff: noqa: F811
from test_workflow import client, db, project, state, turn, wait  # noqa: F401

from app.agent_schemas import Composition
from app.errors import AppError
from app.services.agent_memory import validate_composition


def agent(c, pid):
    return c.get(f"/api/v1/projects/{pid}/agent").json()


def edit(c, pid, node, **changes):
    data = {k: node[k] for k in ("title", "summary", "lane", "category", "status", "include_in_story")}
    data.update(base_version=node["version"], request_id=str(uuid4()))
    data.update(changes)
    return c.patch(f"/api/v1/projects/{pid}/nodes/{node['id']}", json=data)


def prepare(c):
    pid = project(c)
    r, _ = turn(c, pid, "主角想寻找失踪的师父。世界里使用武功必须付出记忆。今天我很累")
    assert wait(c, r["run_id"])["status"] == "succeeded"
    return pid


def test_mixed_memory_source_and_user_confirmation(client):
    pid = prepare(client)
    a = agent(client, pid)
    assert [n["lane"] for n in a["nodes"]] == ["main", "main", "auxiliary"]
    assert all(n["status"] == "draft" for n in a["nodes"])
    goal = a["current_goal"]
    r, _ = turn(client, pid, "设定：主角不再寻找师父", lane="auxiliary")
    assert wait(client, r["run_id"])["status"] == "succeeded"
    assert not state(client, pid)["artifacts"]
    assert agent(client, pid)["current_goal"] == goal
    n = a["nodes"][0]
    assert edit(client, pid, n, status="confirmed").status_code == 200
    assert edit(client, pid, n, status="confirmed").status_code == 409
    source = client.get(f"/api/v1/projects/{pid}/nodes/{n['id']}/source").json()
    assert n["source_quote"] in source["user"]["content"]
    assert [v["version"] for v in source["versions"]] == [2, 1]
    other = project(client)
    assert client.get(f"/api/v1/projects/{other}/nodes/{n['id']}/source").status_code == 404


def test_compose_excludes_auxiliary_tracks_versions_and_invalidates(client):
    pid = prepare(client)
    a = agent(client, pid)
    for n in a["nodes"]:
        assert edit(client, pid, n, status="confirmed").status_code == 200
    a = agent(client, pid)
    payload = dict(
        request_id=str(uuid4()),
        base_revision=state(client, pid)["project"]["revision"],
        agent_revision=a["agent_revision"],
    )
    endpoint = f"/api/v1/projects/{pid}/stories/compose"
    response = client.post(endpoint, json=payload)
    assert response.status_code == 202, response.text
    rid = response.json()["run_id"]
    assert wait(client, rid)["status"] == "succeeded"
    assert client.post(endpoint, json=payload).json()["run_id"] == rid
    story = agent(client, pid)["stories"][0]
    assert set(story["node_versions"]) == {n["id"] for n in a["nodes"] if n["lane"] == "main"}
    assert len(story["skill_hash"]) == 64
    assert story["mode"] == "mock"
    export = client.get(f"/api/v1/projects/{pid}/stories/{story['id']}/export")
    assert "模拟生成" in export.text and "节点连接" in export.text
    assert edit(client, pid, a["nodes"][0], status="withdrawn").status_code == 200
    assert agent(client, pid)["stories"][0]["status"] == "stale"


def test_unconfirmed_nodes_cannot_generate(client):
    pid = prepare(client)
    response = client.post(
        f"/api/v1/projects/{pid}/stories/compose",
        json=dict(
            request_id=str(uuid4()),
            base_revision=state(client, pid)["project"]["revision"],
            agent_revision=agent(client, pid)["agent_revision"],
        ),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "PROTAGONIST_REQUIRED"


@pytest.mark.parametrize(
    "edges,ids,code",
    [
        ([], ["a", "b"], "STORY_DISCONNECTED"),
        ([("a", "b"), ("b", "a")], ["a", "b"], "STORY_CYCLE"),
        ([("a", "b")], ["a", "missing"], "STORY_COVERAGE_INVALID"),
    ],
)
def test_invalid_story_graph_rejected(edges, ids, code):
    output = Composition(
        title="故事",
        synopsis="摘要",
        chapters=[dict(title="章节", content="正文", node_ids=ids)],
        connections=[dict(source_id=a, target_id=b, relation="follows", reason="承接") for a, b in edges],
        assumptions=[],
    )
    with pytest.raises(AppError) as error:
        validate_composition(output, {"nodes": [{"id": "a", "lane": "main"}, {"id": "b", "lane": "main"}]})
    assert error.value.code == code


def test_selected_chat_influences_story_without_replacing_main(client):
    pid = prepare(client)
    for n in agent(client, pid)["nodes"]:
        assert (
            edit(client, pid, n, status="confirmed", include_in_story=n["lane"] == "auxiliary").status_code
            == 200
        )
    a = agent(client, pid)
    response = client.post(
        f"/api/v1/projects/{pid}/stories/compose",
        json=dict(
            request_id=str(uuid4()),
            base_revision=state(client, pid)["project"]["revision"],
            agent_revision=a["agent_revision"],
        ),
    )
    assert response.status_code == 202
    assert wait(client, response.json()["run_id"])["status"] == "succeeded"
    story = agent(client, pid)["stories"][0]
    auxiliary = next(n for n in a["nodes"] if n["lane"] == "auxiliary")
    assert auxiliary["id"] in story["chapters"][0]["node_ids"]
    assert "今天我很累" in story["chapters"][0]["content"]
    assert any(
        e["source_id"] == auxiliary["id"] and e["relation"] == "supports" for e in story["connections"]
    )


def test_generate_from_saved_summaries_preserves_draft_status(client):
    pid = prepare(client)
    a = agent(client, pid)
    response = client.post(
        f"/api/v1/projects/{pid}/stories/compose",
        json=dict(
            request_id=str(uuid4()),
            base_revision=state(client, pid)["project"]["revision"],
            agent_revision=a["agent_revision"],
            use_summaries=True,
        ),
    )
    assert response.status_code == 202, response.text
    assert wait(client, response.json()["run_id"])["status"] == "succeeded"
    updated = agent(client, pid)
    assert all(n["status"] == "draft" for n in updated["nodes"])
    assert len(updated["stories"][0]["node_versions"]) == 3


def test_cancel_dialogue_then_compose_does_not_save_late_reply(client):
    import asyncio

    pid = prepare(client)
    gateway = client.app.state.runner.gateway
    original = gateway.generate

    async def delayed(context, reserve):
        if context.get("_task") == "agent":
            await asyncio.sleep(5)
        return await original(context, reserve)

    gateway.generate = delayed
    pending, _ = turn(client, pid, "主角继续向前")
    response = client.post(f"/api/v1/runs/{pending['run_id']}/cancel", json={})
    assert response.json()["status"] == "cancelled"
    a = agent(client, pid)
    response = client.post(
        f"/api/v1/projects/{pid}/stories/compose",
        json=dict(
            request_id=str(uuid4()),
            base_revision=state(client, pid)["project"]["revision"],
            agent_revision=a["agent_revision"],
            use_summaries=True,
        ),
    )
    assert response.status_code == 202
    assert wait(client, response.json()["run_id"])["status"] == "succeeded"
    assert len(agent(client, pid)["nodes"]) == 3
    assert wait(client, pending["run_id"])["status"] == "cancelled"


def test_guided_answers_keep_question_context_and_survive_reload(client):
    pid = project(client)
    initial = client.get(f"/api/v1/projects/{pid}/guidance").json()
    assert initial["next"]["id"] == "world_place"
    for qid, answer in [
        ("world_place", "一个渔村"),
        ("hero", "阿青，要找回母亲"),
        ("past", "十年前遭遇洪水"),
    ]:
        r, _ = turn(client, pid, answer, question_id=qid)
        assert wait(client, r["run_id"])["status"] == "succeeded"
    nodes = agent(client, pid)["nodes"]
    assert all(n["lane"] == "main" for n in nodes)
    assert [n["category"] for n in nodes] == ["world", "protagonist", "plot"]
    assert "问题：" in nodes[-1]["summary"] and "十年前遭遇洪水" in nodes[-1]["summary"]
    progress = client.get(f"/api/v1/projects/{pid}/guidance").json()
    assert progress["answered"] == 3 and progress["next"]["id"] == "world_rule"
    assert edit(client, pid, nodes[0], status="withdrawn").status_code == 200
    assert client.get(f"/api/v1/projects/{pid}/guidance").json()["next"]["id"] == "world_place"


def test_full_interview_can_generate_ordered_novel(client):
    from app.services.guidance import STEPS

    pid = project(client)
    for key, _, title, _ in reversed(STEPS):
        r, _ = turn(client, pid, title + "的回答：在第三天抵达渡口", question_id=key)
        assert wait(client, r["run_id"])["status"] == "succeeded"
    a = agent(client, pid)
    response = client.post(
        f"/api/v1/projects/{pid}/stories/compose",
        json=dict(
            request_id=str(uuid4()),
            base_revision=state(client, pid)["project"]["revision"],
            agent_revision=a["agent_revision"],
            use_summaries=True,
        ),
    )
    assert response.status_code == 202, response.text
    assert wait(client, response.json()["run_id"])["status"] == "succeeded"
    chapters = agent(client, pid)["stories"][0]["chapters"]
    assert "世界舞台" in chapters[0]["title"] and "结局" in chapters[-1]["title"]


def test_model_controls_followup_wording_and_topic(client):
    from app.agent_schemas import AgentTurn, MemorySegment

    pid = project(client)

    async def custom(context, reserve):
        return AgentTurn(
            reply="我们再具体一点。",
            questions=["这个渔村为何禁止夜间出海？"],
            next_question_id="world_place",
            memories=[
                MemorySegment(
                    lane="main",
                    category="world",
                    title="渔村",
                    summary="用户提出渔村背景，细节待定。",
                    source_quote=context["text"],
                )
            ],
        ), {"mock": True}

    client.app.state.runner.gateway.generate = custom
    r, _ = turn(client, pid, "一个渔村", question_id="world_place")
    assert wait(client, r["run_id"])["status"] == "succeeded"
    followup = client.get(f"/api/v1/projects/{pid}/guidance").json()["next"]
    assert followup["id"] == "world_place"
    assert followup["question"] == "这个渔村为何禁止夜间出海？"
