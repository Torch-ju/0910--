"""Local DeepSeek setup, verified before atomic persistence and live activation."""

import json
import os
import tempfile

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import func, select

from app.config import ROOT, Settings
from app.db import Run
from app.errors import AppError
from app.schemas import Strict
from app.services.deepseek import check_connection

CONFIG_PATH = ROOT / ".env"


class ConnectModel(Strict):
    api_key: str = Field(default="", max_length=500, repr=False)
    model: str = Field(default="deepseek-flash", min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")
    call_budget: int = Field(default=100, ge=1, le=100000)


def persist(values):
    path = CONFIG_PATH
    lines = path.read_text().splitlines() if path.exists() else []
    keys = set(values)
    kept = [
        line for line in lines if line.strip().removeprefix("export ").split("=", 1)[0].strip() not in keys
    ]
    content = "\n".join(kept + [f"{key}={json.dumps(value)}" for key, value in values.items()]) + "\n"
    fd, name = tempfile.mkstemp(prefix=".model-config-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def router(cfg, db):
    routes = APIRouter(prefix="/api/v1/model")

    @routes.post("/connect")
    async def connect(data: ConnectModel):
        key = data.api_key or (cfg.model_api_key if cfg.model_provider == "deepseek" else "")
        if not key or any(c.isspace() for c in key):
            raise AppError("MODEL_KEY_INVALID", "请填写有效的 DeepSeek API Key，不能包含空白。", 422)
        candidate = Settings(
            _env_file=None,
            **{
                **cfg.model_dump(),
                "model_provider": "deepseek",
                "model_name": data.model,
                "model_base_url": "https://api.deepseek.com",
                "model_api_key": key,
                "deepseek_api_key": key,
                "model_call_budget": data.call_budget,
            },
        )
        await check_connection(candidate)
        with db.transaction() as session:
            if session.scalar(select(Run.id).where(Run.status.in_(["queued", "running"])).limit(1)):
                raise AppError("RUN_BUSY", "请先停止或完成正在进行的任务，再切换模型。", 409)
            used = session.scalar(select(func.sum(Run.attempts))) or 0
            if data.call_budget <= used:
                raise AppError("BUDGET_EXHAUSTED", f"累计已请求 {used} 次，请将总上限设为更大的值。", 422)
            values = {
                "MODEL_PROVIDER": "deepseek",
                "MODEL_NAME": data.model,
                "MODEL_BASE_URL": candidate.model_base_url,
                "MODEL_API_KEY": "",
                "DEEPSEEK_API_KEY": key,
                "MODEL_CALL_BUDGET": data.call_budget,
            }
            persist(values)
            for field in (
                "model_provider",
                "model_name",
                "model_base_url",
                "model_api_key",
                "deepseek_api_key",
                "model_call_budget",
            ):
                setattr(cfg, field, getattr(candidate, field))
        return {"status": "ok", "provider": "deepseek", "model": cfg.model_name, "generation_tested": False}

    return routes
