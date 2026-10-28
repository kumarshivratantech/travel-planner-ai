from app.helpers.langchain_llm import get_structured_llm
from app.schemas.preference import TripPreferences
from app.schemas.travel_planner import TravelPlannerState


def SupervisorAgent(state: TravelPlannerState) -> TravelPlannerState:
    current = state.get("preferences") or TripPreferences()
    latest = get_structured_llm(TripPreferences).invoke(state["messages"])

    merged = current.model_copy(update=latest.model_dump(exclude_none=True))
    state["preferences"] = merged
    state["missing_fields"] = merged.missing_fields()
    print(state["missing_fields"])
    return state
