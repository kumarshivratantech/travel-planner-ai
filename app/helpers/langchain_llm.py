from langchain_anthropic import ChatAnthropic
from app.config import settings

llm_structured = ChatAnthropic(
    api_key=settings.anthropic_api_key,
    model_name=settings.anthropic_model_name
)

def get_structured_llm(response_type):
    return llm_structured.with_structured_output(response_type)


