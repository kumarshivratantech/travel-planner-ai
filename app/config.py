from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class ConfigSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )
    app_name: str = "travel planner"
    environment: str = "dev"  # dev | staging | prod
    log_level: str = "INFO"
    use_mocks: bool = False
    anthropic_api_key: str
    anthropic_model_name: str


@lru_cache
def get_settings() -> ConfigSettings:
    return ConfigSettings()


settings = get_settings()
