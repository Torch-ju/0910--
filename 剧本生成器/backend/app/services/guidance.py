"""Project-scoped interview progress derived from live, traceable story nodes."""

from sqlalchemy import select

from app.db import Project, Run, StoryNode
from app.errors import AppError

STEPS = [
    ("world_place", "world", "世界舞台", "故事发生在什么时代、什么地方？那里的人们怎样生活？"),
    ("world_rule", "world", "核心规则", "这个世界最重要的一条规则是什么？违反它会付出什么代价？"),
    ("world_power", "world", "势力冲突", "谁掌握这里的权力？不同势力为什么发生冲突？"),
    ("hero", "protagonist", "主角目标", "主角是谁？他最想得到什么，又最害怕失去什么？"),
    ("past", "plot", "前史", "故事开始以前，哪件事造成了主角现在的处境？大约发生在多久以前？"),
    ("start", "plot", "开端", "故事第一天发生了什么，让主角不得不开始行动？"),
    ("turn", "plot", "转折", "开端之后多久，主角遭遇第一次重大转折？前一事件如何导致它？"),
    ("climax", "plot", "高潮", "转折之后，主角必须作出什么最艰难的选择？要付出什么代价？"),
    ("ending", "plot", "结局", "选择之后发生了什么？主角和这个世界分别有什么变化？"),
]


def question(qid):
    for i, (key, category, title, prompt) in enumerate(STEPS):
        if key == qid:
            return dict(id=key, category=category, title=title, question=prompt, order=i)
    raise AppError("QUESTION_NOT_FOUND", "引导问题不存在，请刷新后再选择。", 422)


def progress(s, pid):
    answers = {}
    for node, run in s.execute(
        select(StoryNode, Run)
        .join(Run, Run.id == StoryNode.run_id)
        .where(StoryNode.project_id == pid, StoryNode.status.not_in(["withdrawn", "stale"]))
        .order_by(StoryNode.created_at)
    ):
        q = run.context.get("guided_question")
        if q and node.lane == "main" and node.category == q["category"]:
            answers[q["id"]] = dict(node_id=node.id, summary=node.summary, status=node.status)
    steps = [{**question(key), "answer": answers.get(key)} for key, *_ in STEPS]
    latest = s.scalar(
        select(Run)
        .where(Run.project_id == pid, Run.status == "succeeded", Run.task_kind == "guide")
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    followup = (
        latest.context.get("next_guided_question")
        if latest and latest.context.get("guidance_revision") == s.get(Project, pid).agent_revision
        else None
    )
    if followup:
        for step in steps:
            if step["id"] == followup["id"]:
                step["question"] = followup["question"]
    return {
        "steps": steps,
        "answered": len(answers),
        "total": len(STEPS),
        "next": next((q for q in steps if followup and q["id"] == followup["id"]), None)
        or next((q for q in steps if not q["answer"]), None),
    }
