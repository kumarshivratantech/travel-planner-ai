import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.agents.intake import process_travel_planner

log = logging.getLogger("strevilatte")

# Finds the `static` folder whether this file sits in the project root or in app/.
HERE = Path(__file__).resolve().parent
STATIC_DIR = next(
    (p / "static" for p in (HERE, HERE.parent) if (p / "static" / "index.html").exists()),
    HERE / "static",
)

app = FastAPI(title="Strevilatte", version="1.0.0")


class ChatIn(BaseModel):
    session_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    message: str = Field(min_length=1, max_length=4000)


def _text_of(msg) -> str:
    """Plain text of a LangChain message (content may be a string or a list of parts)."""
    content = getattr(msg, "content", msg)

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [p if isinstance(p, str) else p.get("text", "") for p in content if isinstance(p, (str, dict))]
        return "".join(parts)
    return str(content)

def _interrupt_text(result: dict) -> str:
    """Question text from a LangGraph `__interrupt__` entry, e.g. {'question': 'Where would you like to go?'}."""
    pending = result.get("__interrupt__")


    if not pending:
        return ""
    first = pending[0] if isinstance(pending, (list, tuple)) else pending
    value = getattr(first, "value", first)
    if isinstance(value, dict):
        return str(value.get("question") or value.get("message") or json.dumps(value, default=str))
    return str(value)

def to_reply(result) -> str:
    if result is None:
        return ""
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        asked = _interrupt_text(result)                     # graph paused to ask the user something
        if asked:
            return asked
        for key in ("reply", "response", "answer", "final_response", "output"):
            if isinstance(result.get(key), str) and result[key].strip():
                return result[key]
        for msg in reversed(result.get("messages") or []):  # newest assistant message only
            if getattr(msg, "type", None) == "ai" and _text_of(msg).strip():
                return _text_of(msg)
        return ""                                           # never echo the user's own message back
    return _text_of(result)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/chat")
def chat(body: ChatIn):
    try:
        result = process_travel_planner(user_id=body.session_id, user_message=body.message.strip())
    except Exception:
        log.exception("travel planner failed")
        raise HTTPException(500, "The assistant ran into a problem. Please try again.")

    return {"reply": to_reply(result) or "I couldn't produce an answer for that. Could you rephrase it?"}


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")



