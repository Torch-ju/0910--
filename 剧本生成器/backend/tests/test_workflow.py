import asyncio
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import Base, Database, Decision, Message, Run, RunEvent
from app.main import create_app
from app.schemas import GuideTurn
from app.services.model_gateway import parse_output


@pytest.fixture
def db(tmp_path):
    database = Database(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(database.engine)
    yield database
    database.engine.dispose()


@pytest.fixture
def client(db):
    cfg = Settings(_env_file=None, model_provider="mock", context_token_budget=24000)
    with TestClient(create_app(cfg, db)) as c:
        yield c


def project(c, title="测试故事"):
    response = c.post("/api/v1/projects", json={"title": title})
    assert response.status_code == 201
    return response.json()["project"]["id"]


def state(c, pid):
    return c.get(f"/api/v1/projects/{pid}").json()


def turn(c, pid, text="还没想法", **overrides):
    data = {
        "text": text,
        "client_request_id": str(uuid4()),
        "base_revision": state(c, pid)["project"]["revision"],
    }
    data.update(overrides)
    response = c.post(f"/api/v1/projects/{pid}/turns", json=data)
    assert response.status_code == 202, response.text
    return response.json(), data


def wait(c, rid):
    for _ in range(100):
        r = c.get(f"/api/v1/runs/{rid}").json()
        if r["status"] not in ("queued", "running"):
            return r
        time.sleep(0.02)
    raise AssertionError("run did not finish")


def suggestions(c, pid):
    r, _ = turn(c, pid)
    assert wait(c, r["run_id"])["status"] == "succeeded"
    return state(c, pid)["proposals"]


def decide(c, pid, action, target, **extra):
    data = {
        "action": action,
        "target_id": target,
        "base_revision": state(c, pid)["project"]["revision"],
        "request_id": str(uuid4()),
    }
    data.update(extra)
    return c.post(f"/api/v1/projects/{pid}/decisions", json=data)


def add(c, pid, content="主角不相信师父", **extra):
    data = {
        "title": "主角",
        "content": content,
        "kind": "character_note",
        "base_version": 0,
        "base_revision": state(c, pid)["project"]["revision"],
        "request_id": str(uuid4()),
    }
    data.update(extra)
    return c.post(f"/api/v1/projects/{pid}/artifacts", json=data)


def test_accept_is_persisted_and_other_candidates_expire(client):
    pid = project(client)
    qs = suggestions(client, pid)
    assert len(qs) == 2
    response = decide(client, pid, "accept", qs[1]["id"])
    assert response.status_code == 200
    data = state(client, pid)
    assert data["artifacts"][0]["content"] == qs[1]["content"]
    assert {q["status"] for q in data["proposals"]} == {"accepted", "stale"}
    assert decide(client, pid, "accept", qs[0]["id"]).status_code == 409


def test_ambiguous_then_explicit_choice(client, db):
    pid = project(client)
    suggestions(client, pid)
    r, _ = turn(client, pid, "都挺好")
    wait(client, r["run_id"])
    assert not state(client, pid)["artifacts"]
    r, _ = turn(client, pid, "用第二个")
    assert wait(client, r["run_id"])["status"] == "succeeded"
    assert "守桥" in state(client, pid)["artifacts"][0]["title"]
    with db.transaction() as s:
        d = s.scalar(select(Decision))
        assert d.evidence.startswith("message:")


@pytest.mark.parametrize("text", ["不要用第二个", "他喊道：用第二个", "用第二个？或者第一个", "就这个"])
def test_non_authorizing_text_never_accepts(client, text):
    pid = project(client)
    suggestions(client, pid)
    r, _ = turn(client, pid, text)
    wait(client, r["run_id"])
    assert not state(client, pid)["artifacts"]


def test_request_replay_is_idempotent(client, db):
    pid = project(client)
    r, payload = turn(client, pid)
    wait(client, r["run_id"])
    again = client.post(f"/api/v1/projects/{pid}/turns", json=payload)
    assert again.json()["run_id"] == r["run_id"]
    payload["text"] = "不同内容"
    assert client.post(f"/api/v1/projects/{pid}/turns", json=payload).status_code == 409
    with db.transaction() as s:
        assert len(list(s.scalars(select(Run)))) == 1
        assert len(list(s.scalars(select(Message).where(Message.role == "user")))) == 1


def test_decision_replay_and_old_revision(client):
    pid = project(client)
    q = suggestions(client, pid)[0]
    req = str(uuid4())
    assert decide(client, pid, "accept", q["id"], request_id=req).status_code == 200
    assert decide(client, pid, "accept", q["id"], request_id=req, base_revision=0).status_code == 200
    assert add(client, pid, base_revision=0).status_code == 409
    assert len(state(client, pid)["artifacts"]) == 1


def test_direct_edits_withdraw_restore_history(client):
    pid = project(client)
    aid = add(client, pid).json()["artifact_id"]
    response = client.patch(
        f"/api/v1/projects/{pid}/artifacts/{aid}",
        json={
            "title": "主角",
            "content": "主角开始信任师父",
            "kind": "character_note",
            "base_version": 1,
            "base_revision": 1,
            "request_id": str(uuid4()),
        },
    )
    assert response.status_code == 200
    assert decide(client, pid, "withdraw", aid).status_code == 200
    assert state(client, pid)["artifacts"][0]["active"] is False
    assert "主角开始信任师父" not in client.get(f"/api/v1/projects/{pid}/export").text
    assert decide(client, pid, "restore", aid).status_code == 200
    versions = client.get(f"/api/v1/projects/{pid}/artifacts/{aid}/versions").json()["items"]
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[1]["content"] == "主角不相信师父"


def test_cross_project_and_origin_boundaries(client):
    a, b = project(client, "甲"), project(client, "乙")
    aid = add(client, a).json()["artifact_id"]
    assert decide(client, b, "withdraw", aid).status_code == 404
    assert client.get(f"/api/v1/projects/{b}/artifacts/{aid}/versions").status_code == 404
    assert "师父" not in client.get(f"/api/v1/projects/{b}/export").text
    assert (
        client.post(
            "/api/v1/projects", json={"title": "非法"}, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )


def test_user_original_setting_and_export(client):
    pid = project(client)
    r, _ = turn(client, pid, "设定：主角是一位失明的女镖师")
    wait(client, r["run_id"])
    assert state(client, pid)["artifacts"][0]["content"] == "主角是一位失明的女镖师"
    exported = client.get(f"/api/v1/projects/{pid}/export")
    assert "主角是一位失明的女镖师" in exported.text
    assert "待定" in exported.text


class SlowGateway:
    async def generate(self, context, reserve):
        await asyncio.sleep(0.3)
        return GuideTurn(
            reply="旧资料生成的草稿",
            proposals=[
                {"kind": "story_seed", "title": "旧建议", "content": "不该被采用", "rationale": "基于旧资料"}
            ],
        ), {}


def test_revision_changes_while_generating_make_result_stale(db):
    with TestClient(create_app(Settings(_env_file=None), db, SlowGateway())) as c:
        pid = project(c)
        r, _ = turn(c, pid)
        assert add(c, pid).status_code == 201
        result = wait(c, r["run_id"])
        assert result["status"] == "stale"
        q = state(c, pid)["proposals"][0]
        assert q["status"] == "stale"
        assert decide(c, pid, "accept", q["id"]).status_code == 409


def test_cancel_prevents_late_write_and_preserves_input(db):
    with TestClient(create_app(Settings(_env_file=None), db, SlowGateway())) as c:
        pid = project(c)
        r, _ = turn(c, pid)
        response = c.post(f"/api/v1/runs/{r['run_id']}/cancel", json={})
        assert response.json()["status"] == "cancelled"
        time.sleep(0.4)
        assert state(c, pid)["proposals"] == []
        events = c.get(f"/api/v1/runs/{r['run_id']}/events").text
        assert "event: error" in events and "RUN_CANCELLED" in events


def test_recovery_of_orphaned_run(db):
    cfg = Settings(_env_file=None)
    with TestClient(create_app(cfg, db)) as c:
        pid = project(c)
        q = suggestions(c, pid)[0]
        decide(c, pid, "accept", q["id"])
        with db.transaction() as s:
            r = s.scalar(select(Run))
            r.status = "running"
            rid = r.id
            for e in s.scalars(select(RunEvent).where(RunEvent.run_id == rid)):
                s.delete(e)
    with TestClient(create_app(cfg, db)) as c:
        assert c.get(f"/api/v1/runs/{rid}").json()["status"] == "interrupted"
        assert len(state(c, pid)["artifacts"]) == 1
        assert "RUN_INTERRUPTED" in c.get(f"/api/v1/runs/{rid}/events").text


def test_sse_replay_and_terminal_event(client):
    pid = project(client)
    r, _ = turn(client, pid)
    wait(client, r["run_id"])
    text = client.get(f"/api/v1/runs/{r['run_id']}/events").text
    assert text.count("event: done") == 1 and "event: error" not in text
    assert client.get(f"/api/v1/runs/{r['run_id']}/events?after_seq=1").text == ""


class BrokenGateway:
    async def generate(self, context, reserve):
        raise RuntimeError("secret_should_not_leak")


def test_unknown_error_is_redacted(db):
    with TestClient(create_app(Settings(_env_file=None), db, BrokenGateway())) as c:
        pid = project(c)
        r, _ = turn(c, pid)
        result = wait(c, r["run_id"])
        assert result["error"]["code"] == "GENERATION_FAILED"
        assert "secret_should_not_leak" not in str(result)


def test_real_mode_missing_key_does_not_fallback(db):
    cfg = Settings(_env_file=None, model_provider="compatible", model_api_key="")
    with TestClient(create_app(cfg, db)) as c:
        pid = project(c)
        r, _ = turn(c, pid)
        result = wait(c, r["run_id"])
        assert result["error"]["code"] == "MODEL_NOT_CONFIGURED"
        assert state(c, pid)["proposals"] == []


def test_format_wrappers_and_count_quality():
    result = parse_output('```json\n{"reply":"你好","questions":["一","二","三"],"proposals":[]}\n```')
    assert len(result.questions) == 3
    with pytest.raises(ValueError):
        parse_output('{"reply":"你好","accepted":true}')


def test_invalid_input_is_uniform(client):
    response = client.post("/api/v1/projects", json={"title": ""})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_INPUT"


def test_context_overflow_preserves_user_message(db):
    cfg = Settings(_env_file=None, context_token_budget=1000)
    with TestClient(create_app(cfg, db)) as c:
        pid = project(c)
        add(c, pid, content="大量资料" * 300)
        r, _ = turn(c, pid, "继续")
        assert wait(c, r["run_id"])["error"]["code"] == "CONTEXT_LIMIT"
        assert c.get(f"/api/v1/projects/{pid}/messages").json()["items"][0]["content"] == "继续"
