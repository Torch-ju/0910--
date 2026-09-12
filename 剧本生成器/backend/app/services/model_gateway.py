import asyncio
import json
from functools import partial
from pathlib import Path

import httpx
from pydantic import ValidationError

from app.errors import AppError
from app.schemas import GuideTurn

PROMPT = (Path(__file__).parent / "prompts/guide_turn_v1.md").read_text()


def parse_output(text, schema=GuideTurn):
    text = text.strip()
    if text.startswith("```") and text.endswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return schema.model_validate_json(text)


def mock_guide(context):
    """Deterministic fixtures for engineering only; never advertised as model quality."""
    text = context["text"]
    if text in ("都不错", "都挺好", "以后再说", "都可以"):
        return GuideTurn(
            reply="这些方向先保留为待讨论，没有采用任何设定。", questions=["你更想继续聊哪一个方向？"]
        )
    if "跳过" in text or "回到" in text:
        return GuideTurn(
            reply="好，这个问题先放一放。已有决定会保留。",
            questions=["此刻更想聊人物，还是故事里的一个场景？"],
        )
    if any(word in text for word in ["不喜欢", "换一个", "拒绝"]):
        return GuideTurn(
            reply="我们换个角度，暂时不沿用刚才的建议。",
            questions=["有没有一个你很想写、却还没找到位置的画面？"],
        )
    if text.startswith("设定：") or text.startswith("设定:"):
        return GuideTurn(
            reply="这段原话已作为你的设定保存。后续建议会以它为依据。",
            questions=["这个设定会给人物带来什么困难？"],
        )
    if not context["artifacts"] and any(w in text for w in ["没想法", "没方向", "给我启发", "开始"]):
        return GuideTurn(
            reply="可以先抓住一个小人物面前的难题。下面是两个供你试看的故事种子，选择、改写或全部拒绝都可以。",
            questions=["哪一种矛盾更让你想写下去？"],
            proposals=[
                {
                    "kind": "story_seed",
                    "title": "一封不该送到的信",
                    "content": "一个送信人发现，收信人是自己寻找多年的仇人，而信里藏着救他性命的消息。",
                    "rationale": "让谋生、复仇与救人落在同一次选择里。",
                },
                {
                    "kind": "story_seed",
                    "title": "最后一个守桥人",
                    "content": "一名不会武功的守桥人，必须在天亮前决定是否放一群被追捕的人过桥，其中有他曾经出卖的朋友。",
                    "rationale": "能力有限的人，也能做出改变命运的选择。",
                },
            ],
        )
    basis = context["artifacts"][-1]["content"][:100] if context["artifacts"] else text[:100]
    return GuideTurn(
        reply=f"我们先围绕“{basis}”继续。可以把人物最想得到的东西，与他不愿付出的代价放在一起看。",
        questions=["他最不愿失去的是什么？"],
        proposals=[
            {
                "kind": "open_question",
                "title": "值得追问的代价",
                "content": f"围绕“{basis}”，探索人物实现目标时可能损害的一段关系。具体关系和结果尚待你决定。",
                "rationale": "用选择推动人物，而不预先替你确定结局。",
            }
        ],
    )


class Gateway:
    def __init__(self, settings):
        self.settings = settings

    async def generate(self, context, reserve_attempt):
        from app.agent_schemas import AgentTurn, Composition
        from app.services.agent_memory import mock_agent, mock_composition

        task = context.get("_task", "guide")
        if task == "compose":
            schema = Composition
            prompt = (Path(__file__).parent / "prompts/compose_story_v1.md").read_text()
            mock = partial(mock_composition, context)
        elif task == "agent":
            schema = AgentTurn
            prompt = (Path(__file__).parent / "prompts/agent_turn_v1.md").read_text()
            mock = partial(mock_agent, context, mock_guide(context))
        else:
            schema, prompt = GuideTurn, PROMPT
            mock = partial(mock_guide, context)
        return await self.complete(context, reserve_attempt, schema, prompt, mock)

    async def complete(self, context, reserve_attempt, schema, prompt, mock):
        cfg = self.settings
        if cfg.model_provider == "mock":
            await asyncio.sleep(0.2)
            return mock(), {"mock": True, "tokens": None}
        if not all([cfg.model_api_key, cfg.model_name, cfg.model_base_url]):
            raise AppError("MODEL_NOT_CONFIGURED", "真实模型尚未配置，请在后端 .env 中填写模型信息。", 503)
        if not cfg.model_base_url.startswith("https://"):
            raise AppError("MODEL_CONFIG_INVALID", "真实模型地址必须使用 HTTPS。", 503)
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
        ]
        usage = []
        error = AppError("MODEL_UNAVAILABLE", "模型暂时不可用，输入已保存，请稍后重试。", 502)
        for attempt in range(max(1, min(cfg.model_max_attempts, 2))):
            reserve_attempt()
            try:
                async with httpx.AsyncClient(timeout=cfg.model_timeout_seconds) as client:
                    response = await client.post(
                        cfg.model_base_url.rstrip("/") + "/chat/completions",
                        headers={"Authorization": "Bearer " + cfg.model_api_key},
                        json={
                            "model": cfg.model_name,
                            **(
                                {"thinking": {"type": "disabled"}} if cfg.model_provider == "deepseek" else {}
                            ),
                            "messages": messages,
                            "max_tokens": cfg.story_output_tokens
                            if context.get("_task", "").startswith(("compose", "novel_"))
                            else cfg.max_output_tokens,
                            "response_format": {"type": "json_object"},
                        },
                    )
                if response.status_code in (401, 403):
                    raise AppError("MODEL_AUTH_FAILED", "模型认证失败，请检查后端密钥与访问权限。", 502)
                if response.status_code == 402:
                    raise AppError(
                        "MODEL_BALANCE_INSUFFICIENT", "DeepSeek 账户余额不足，请检查服务商账户。", 502
                    )
                if response.status_code == 429:
                    error = AppError("MODEL_RATE_LIMIT", "模型服务限流，请稍后重试。", 502)
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                response.raise_for_status()
                body = response.json()
                usage.append(body.get("usage"))
                if body["choices"][0].get("finish_reason") == "length":
                    error = AppError(
                        "MODEL_OUTPUT_TRUNCATED", "模型输出仍被截断，已保留写作进度。可继续写作重试。", 422
                    )
                    messages.append(
                        {
                            "role": "user",
                            "content": "上次 JSON 因长度截断。请把本次内容缩短，完整返回 JSON；若正在写正文，chapter_finished=false，剩余场景留到下次续写，不要强行收尾。",
                        }
                    )
                    continue
                return parse_output(body["choices"][0]["message"]["content"], schema), {"calls": usage}
            except AppError:
                raise
            except (ValidationError, ValueError, KeyError, IndexError, TypeError):
                error = AppError(
                    "MODEL_FORMAT_INVALID", "模型返回格式不完整，没有写入候选设定，请重试。", 502
                )
                messages.append(
                    {"role": "user", "content": "上次输出未通过结构校验。请严格按 system 中 JSON 正例输出。"}
                )
            except httpx.TimeoutException:
                error = AppError("MODEL_TIMEOUT", "模型响应超时，你的输入已保存。", 504)
            except httpx.HTTPError:
                pass
        raise error
