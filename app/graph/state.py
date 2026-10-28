from typing import TypedDict, Annotated
from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

class TRAVEL_PLANNER_STATE(TypedDict):
    user_message : Annotated[list[AnyMessage], add_messages]
    preferences: dict
    flights: list[dict]
    hotels: list[dict]
    activities: list[dict]
    weather: dict
    