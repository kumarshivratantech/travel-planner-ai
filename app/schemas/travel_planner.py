from typing import TypedDict, Annotated, Optional
from langchain_core.messages import AnyMessage, AIMessage, HumanMessage
from langgraph.graph import add_messages

from app.schemas.preference import TripPreferences


class TravelPlannerState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    preferences: TripPreferences
    missing_fields: list[str]
    flight_options: list[str]
    hotel_options: list[str]
    itinerary: Optional[dict]