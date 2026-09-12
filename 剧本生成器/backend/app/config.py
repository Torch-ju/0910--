from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    database_url: str = f"sqlite:///{ROOT / 'data/story.db'}"
    model_provider: Literal["mock", "compatible", "deepseek"] = "mock"
    model_name: str = ""
    model_base_url: str = ""
    model_api_key: str = Field(default="", repr=False)
    deepseek_api_key: str = Field(default="", repr=False)
    model_timeout_seconds: float = 90
    model_max_attempts: int = 2
    max_output_tokens: int = 2400
    story_output_tokens: int = 6000
    novel_context_bytes: int = 180000
    context_token_budget: int = 12000
    model_call_budget: int = 0
    allowed_origins: str = "http://127.0.0.1:3001,http://localhost:3001"

    @model_validator(mode="after")
    def resolve_provider(self):
        if self.model_provider == "deepseek":
            self.model_name = self.model_name or "deepseek-flash"
            self.model_base_url = self.model_base_url or "https://api.deepseek.com"
            if self.model_base_url.rstrip("/") not in (
                "https://api.deepseek.com",
                "https://api.deepseek.com/v1",
            ):
                raise ValueError("DeepSeek provider requires its official HTTPS endpoint")
            self.model_api_key = self.deepseek_api_key or self.model_api_key
        return self

    @property
    def origins(self):
        return self.allowed_origins.split(",")
