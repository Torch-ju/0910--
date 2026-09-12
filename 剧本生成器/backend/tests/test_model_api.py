import stat

import httpx
from test_workflow import client, db  # noqa: F401

# ruff: noqa: F811


def test_connect_persists_secret_privately_and_activates_without_restart(client, monkeypatch, tmp_path):
    from app import model_api
    from app.config import Settings

    target = tmp_path / ".env"
    target.write_text("CONTEXT_TOKEN_BUDGET=24000\n# keep me\n")
    monkeypatch.setattr(model_api, "CONFIG_PATH", target)
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(200, json={"data": [{"id": "deepseek-flash"}]})
            ),
            **kw,
        ),
    )
    response = client.post(
        "/api/v1/model/connect",
        json={"api_key": "local-test-secret", "model": "deepseek-flash", "call_budget": 100},
    )
    assert response.status_code == 200, response.text
    assert "local-test-secret" not in response.text
    assert "local-test-secret" not in client.get("/api/v1/model/status").text
    assert client.get("/api/v1/health").json()["mode"] == "real"
    restored = Settings(_env_file=target)
    assert restored.model_api_key == "local-test-secret"
    assert restored.context_token_budget == 24000
    assert stat.S_IMODE(target.stat().st_mode) == 0o600


def test_bad_key_never_changes_configuration(client, monkeypatch, tmp_path):
    from app import model_api

    target = tmp_path / ".env"
    monkeypatch.setattr(model_api, "CONFIG_PATH", target)
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(lambda r: httpx.Response(401)), **kw),
    )
    response = client.post("/api/v1/model/connect", json={"api_key": "bad-secret"})
    assert response.status_code == 502
    assert not target.exists()
    assert client.get("/api/v1/health").json()["mode"] == "mock"
    assert "bad-secret" not in response.text
