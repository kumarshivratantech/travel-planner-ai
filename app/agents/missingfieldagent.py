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
    missing = [f for f in state.get("missing_fields", []) if f in FIELD_QUESTIONS]
    if not missing:
        return {}

    questions = [FIELD_QUESTIONS[f] for f in missing]
    if len(questions) == 1:
        text = questions[0]
    else:
        text = "To plan your trip, I need a few details:\n" + "\n".join(
            f"{i}. {q}" for i, q in enumerate(questions, 1)
        )

    answer = interrupt({"question": text, "missing_fields": missing})

    messages = [
        SystemMessage(content="Extract the final trip preferences from this conversation. "
                              "If the user changed their mind, use the latest value."),
        *state["messages"],
        AIMessage(content=text),
        HumanMessage(content=answer),
    ]
    latest = get_structured_llm(TripPreferences).invoke(messages)

    return {
        "messages": [AIMessage(content=text), HumanMessage(content=answer)],
        "preferences": latest,
        "missing_fields": latest.missing_fields(),
    }