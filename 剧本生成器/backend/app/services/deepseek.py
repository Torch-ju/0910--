"""Credential check via model listing; never sends a user's story or generates text."""

import httpx

from app.errors import AppError


async def check_connection(cfg):
    if cfg.model_provider != "deepseek":
        raise AppError("PROVIDER_NOT_DEEPSEEK", "请先在后端配置 MODEL_PROVIDER=deepseek。", 422)
    if not cfg.model_api_key:
        raise AppError("MODEL_NOT_CONFIGURED", "请在测试/.env 填写 DEEPSEEK_API_KEY 后重启。", 422)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                cfg.model_base_url.rstrip("/") + "/models",
                headers={"Authorization": "Bearer " + cfg.model_api_key},
            )
        if response.status_code in (401, 403):
            raise AppError("MODEL_AUTH_FAILED", "DeepSeek 密钥无效或没有访问权限。", 502)
        if response.status_code == 429:
            raise AppError("MODEL_RATE_LIMIT", "DeepSeek 暂时限流，请稍后检查。", 502)
        response.raise_for_status()
        models = [item["id"] for item in response.json()["data"]]
        if cfg.model_name not in models:
            raise AppError("MODEL_NOT_AVAILABLE", "配置的模型不在当前账户可用列表，请检查 MODEL_NAME。", 422)
        return {"status": "ok", "provider": "deepseek", "model": cfg.model_name, "generation_tested": False}
    except AppError:
        raise
    except httpx.TimeoutException:
        raise AppError("MODEL_TIMEOUT", "DeepSeek 连接检查超时。", 504) from None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise AppError("MODEL_UNAVAILABLE", "DeepSeek 连接检查失败，请稍后重试。", 502) from None
