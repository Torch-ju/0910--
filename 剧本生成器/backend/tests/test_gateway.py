import json

import httpx
import pytest

from app.config import Settings
from app.errors import AppError
from app.services.model_gateway import Gateway

OUTPUT = {"reply": "从一个人物开始。", "questions": ["他想得到什么？"], "proposals": []}


def configure(monkeypatch, handler, **extra):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs)
    )
    cfg = Settings(
        _env_file=None,
        model_provider="compatible",
        model_name="test-model",
        model_base_url="https://mock-model.example/v1",
        model_api_key="test-secret",
        **extra,
    )
    return Gateway(cfg)


@pytest.mark.asyncio
async def test_compatible_contract_and_usage(monkeypatch):
    attempts = []

    def handler(request):
        body = json.loads(request.content)
        assert body["response_format"] == {"type": "json_object"}
        assert body["model"] == "test-model"
        assert request.headers["authorization"] == "Bearer test-secret"
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(OUTPUT)}}], "usage": {"total_tokens": 42}},
        )

    gateway = configure(monkeypatch, handler)
    output, usage = await gateway.generate({"text": "开始"}, lambda: attempts.append(1))
    assert output.reply == OUTPUT["reply"]
    assert usage["calls"][0]["total_tokens"] == 42
    assert len(attempts) == 1


@pytest.mark.parametrize(
    "status,code,count",
    [(401, "MODEL_AUTH_FAILED", 1), (429, "MODEL_RATE_LIMIT", 2), (500, "MODEL_UNAVAILABLE", 2)],
)
@pytest.mark.asyncio
async def test_failure_bounds(monkeypatch, status, code, count):
    attempts = []
    gateway = configure(monkeypatch, lambda _: httpx.Response(status, text="private-upstream-detail"))
    with pytest.raises(AppError) as error:
        await gateway.generate({}, lambda: attempts.append(1))
    assert error.value.code == code
    assert "private" not in error.value.message
    assert len(attempts) == count


@pytest.mark.asyncio
async def test_format_fix_shares_total_attempt_budget(monkeypatch):
    attempts = []
    gateway = configure(
        monkeypatch, lambda _: httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]})
    )
    with pytest.raises(AppError) as error:
        await gateway.generate({}, lambda: attempts.append(1))
    assert error.value.code == "MODEL_FORMAT_INVALID"
    assert len(attempts) == 2


@pytest.mark.asyncio
async def test_timeout_is_public_and_bounded(monkeypatch):
    attempts = []

    def handler(request):
        raise httpx.ReadTimeout("private detail", request=request)

    gateway = configure(monkeypatch, handler)
    with pytest.raises(AppError) as error:
        await gateway.generate({}, lambda: attempts.append(1))
    assert error.value.code == "MODEL_TIMEOUT"
    assert len(attempts) == 2


@pytest.mark.asyncio
async def test_budget_denial_never_reaches_provider(monkeypatch):
    def handler(request):
        raise AssertionError("must not reach network")

    def deny():
        raise AppError("BUDGET_EXHAUSTED", "预算不足")

    gateway = configure(monkeypatch, handler)
    with pytest.raises(AppError) as error:
        await gateway.generate({}, deny)
    assert error.value.code == "BUDGET_EXHAUSTED"


@pytest.mark.asyncio
async def test_deepseek_contract_and_connection_check(monkeypatch):
    from app.services.deepseek import check_connection

    original = httpx.AsyncClient

    def handler(request):
        assert request.headers["authorization"] == "Bearer private-key"
        assert request.url.host == "api.deepseek.com"
        if request.method == "GET":
            return httpx.Response(200, json={"data": [{"id": "deepseek-flash"}]})
        body = json.loads(request.content)
        assert body["model"] == "deepseek-flash"
        assert body["thinking"] == {"type": "disabled"}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(OUTPUT)}}]})

    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw)
    )
    cfg = Settings(_env_file=None, model_provider="deepseek", deepseek_api_key="private-key")
    assert "private-key" not in repr(cfg)
    assert (await check_connection(cfg))["generation_tested"] is False
    output, _ = await Gateway(cfg).generate({"text": "开始"}, lambda: None)
    assert output.reply == OUTPUT["reply"]


def test_deepseek_rejects_wrong_host():
    with pytest.raises(ValueError):
        Settings(_env_file=None, model_provider="deepseek", model_base_url="https://other.example")


@pytest.mark.asyncio
async def test_truncated_output_is_retried_not_saved_as_complete(monkeypatch):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "length" if len(requests) == 1 else "stop",
                        "message": {"content": json.dumps(OUTPUT)},
                    }
                ]
            },
        )

    gateway = configure(monkeypatch, handler)
    output, _ = await gateway.generate({"text": "开始"}, lambda: None)
    assert output.reply == OUTPUT["reply"]
    assert len(requests) == 2
    assert "截断" in requests[-1]["messages"][-1]["content"]
