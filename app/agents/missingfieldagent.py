import json

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.types import interrupt


from app.helpers.langchain_llm import get_structured_llm
from app.schemas.preference import TripPreferences
from app.schemas.travel_planner import TravelPlannerState

FIELD_QUESTIONS = {
    "source": "Which city are you starting from?",
    "stop_location": "Where would you like to go?",
    "return_to_base": "Do you want a return trip, or one-way?",
    "start_date": "What is your travel start date?",
    "adults": "How many adults are travelling?",
}

def missing_fields_node(state: TravelPlannerState) -> TravelPlannerState:
    print("ENTER missing_fields:", state.get("missing_fields"), "| prefs:", state.get("preferences"))
    missing = [f for f in state.get("missing_fields", []) if f in FIELD_QUESTIONS]
    unknown = [f for f in missing if f not in FIELD_QUESTIONS]
    if unknown:
        raise ValueError(f"No question defined for: {unknown}")
    if not missing:
        print("No Missing Data")
        return {}

    questions = [FIELD_QUESTIONS[f] for f in missing]

    text = questions[0] if len(questions) == 1 else (
            "To plan your trip, I need a few details:\n"
            + "\n".join(f"{i}. {q}" for i, q in enumerate(questions, 1))
    )

    answer = interrupt({"question": text, "missing_fields": missing})

    previous = state.get("preferences")
    known = previous.model_dump(exclude_none=True) if previous else {}

    messages = [
        SystemMessage(content=(
            "Extract trip preferences from this conversation. "
            "Only fill a field if the user explicitly stated it. "
            "Never guess or default values (especially adults, children, budget); use null. "
            "If the user changed their mind, use the latest value.\n"
            f"Already known preferences: ..."
        )),
        *state["messages"],
        AIMessage(content=text),
        HumanMessage(content=answer),
    ]
    latest = get_structured_llm(TripPreferences).invoke(messages)
    print(latest)
    # state["preferences"] = latest
    # state["missing_fields"] = latest.missing_fields()
    merged = TripPreferences(**{**known, **latest.model_dump(exclude_none=True)})
    return {
        "messages": [AIMessage(content=text), HumanMessage(content=answer)],
        "preferences": merged,
        "missing_fields": merged.missing_fields(),
    }