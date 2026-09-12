from uuid import uuid4

from test_agent import agent, prepare
from test_workflow import client, db, state, wait  # noqa: F401

from app.agent_schemas import NovelPart, NovelPlan, NovelReview
from app.errors import AppError

# ruff: noqa: F811


class Writer:
    def __init__(self, fail_once=False, repair=False):
        self.writes = 0
        self.fail_once = fail_once
        self.repair = repair
        self.reviews = 0
        self.plans = 0

    async def complete(self, context, reserve, schema, prompt, mock):
        reserve()
        assert "草蛇灰线" in context["skill"]["instructions"]
        assert "表达DNA" in context["skill"]["instructions"]
        if schema is NovelPlan:
            self.plans += 1
            mains = [n["id"] for n in context["nodes"] if n["lane"] == "main"]
            aux = [n["id"] for n in context["nodes"] if n["lane"] == "auxiliary"]
            result = NovelPlan(
                title="渡口",
                synopsis="主角寻找师父并作出选择。",
                ending="师徒重逢，代价由主角承担。",
                threads=["寻找师父"],
                chapters=[
                    dict(
                        title=f"第{i + 1}章",
                        purpose="推进选择",
                        events=["经历考验"],
                        node_ids=([mains[0]] + aux if i == 0 else [mains[-1]]),
                        closes=["寻找师父"] if i == 12 else [],
                    )
                    for i in range(13)
                ],
                connections=[dict(source_id=mains[0], target_id=mains[-1], relation="follows", reason="因果")]
                + [dict(source_id=a, target_id=mains[0], relation="supports", reason="辅助") for a in aux],
                assumptions=[],
            )
        elif schema is NovelPart:
            self.writes += 1
            if self.fail_once and self.writes == 2:
                self.fail_once = False
                raise AppError("MODEL_TIMEOUT", "模拟超时", 504)
            index = context["chapter_index"]
            # Two natural scenes per chapter exercise continuation and >15,000 chars per chapter.
            finish = bool(context["current_tail"])
            result = NovelPart(
                content=f"{index}-{self.writes}：" + ("船靠岸，主角走向渡口。" * 800),
                summary=f"第{index}章完成场景{self.writes}",
                chapter_finished=finish,
                closed_threads=["寻找师父"] if index == 12 and finish else [],
            )
        else:
            assert schema is NovelReview
            self.reviews += 1
            result = NovelReview(
                complete=not (self.repair and self.reviews == 1),
                issues=["缺少重逢"] if self.repair and self.reviews == 1 else [],
                repair_chapters=[12] if self.repair and self.reviews == 1 else [],
                conclusion="检查结局",
            )
        return result, {"calls": [{"total_tokens": 20}]}


def start(c, pid, writer):
    runner = c.app.state.runner
    runner.settings.model_provider = "compatible"
    runner.settings.model_name = "writer-test"
    runner.settings.model_call_budget = 200
    runner.gateway = writer
    response = c.post(
        f"/api/v1/projects/{pid}/stories/compose",
        json=dict(
            request_id=str(uuid4()),
            base_revision=state(c, pid)["project"]["revision"],
            agent_revision=agent(c, pid)["agent_revision"],
            use_summaries=True,
        ),
    )
    assert response.status_code == 202, response.text
    return response.json()["run_id"]


def test_full_story_more_than_12_chapters_and_chunk_continuation(client):
    pid = prepare(client)
    writer = Writer(repair=True)
    rid = start(client, pid, writer)
    result = wait(client, rid)
    assert result["status"] == "succeeded", result
    story = agent(client, pid)["stories"][0]
    assert len(story["chapters"]) == 13
    assert len(story["chapters"][0]["content"]) > 15000
    assert writer.reviews == 2 and writer.plans == 1
    assert writer.writes == 28
    assert client.get(f"/api/v1/projects/{pid}/novel-progress").json()["run"]["stage"] == "complete"


def test_failed_scene_preserves_checkpoint_and_resume_skips_saved_parts(client):
    pid = prepare(client)
    writer = Writer(fail_once=True)
    rid = start(client, pid, writer)
    assert wait(client, rid)["status"] == "failed"
    assert not agent(client, pid)["stories"]
    progress = client.get(f"/api/v1/projects/{pid}/novel-progress").json()["run"]
    assert progress["characters"] > 0 and progress["can_resume"]
    response = client.post(f"/api/v1/projects/{pid}/novels/{rid}/resume", json={})
    assert response.status_code == 202, response.text
    result = wait(client, rid)
    assert result["status"] == "succeeded", result
    assert writer.plans == 1 and writer.writes == 27
    assert len(agent(client, pid)["stories"]) == 1
