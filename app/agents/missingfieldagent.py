from langchain_core.messages import AIMessage

from app.schemas.travel_planner import TravelPlannerState

FIELD_QUESTIONS = {
    "source": "Which city are you starting from?",
    "stop_location": "Where would you like to go?",
    "return_to_base": "Do you want a return trip, or one-way?",
    "start_date": "What is your travel start date?",
    "adults": "How many adults are travelling?",
}

def missing_fields(state: TravelPlannerState) -> TravelPlannerState:
    missing_fields = state["missing_fields"]
    questions = [FIELD_QUESTIONS[f] for f in missing_fields]
    if len(missing_fields) == 1:
        text = questions[0]
    else:
        text = "To plan your trip, I need a few details:\n" + "\n".join(questions)

    return {"messages": [AIMessage(content=text)]}
    return state