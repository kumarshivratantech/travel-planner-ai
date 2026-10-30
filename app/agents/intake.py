from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.constants import START, END
from langgraph.graph import StateGraph
from langgraph.types import Command

from app.agents.flights import flight_planner_node
from app.agents.hotels import hotel_planner_node
from app.agents.missingfieldagent import missing_fields_node
from app.agents.superagent import supervisor_node
from app.agents.weather import weather_planner_agent

from app.schemas.travel_planner import TravelPlannerState

def new_data_agent(state: TravelPlannerState) -> TravelPlannerState:
    print("new_data_agent")
    return state

def conditional_routing_missing(state: TravelPlannerState) -> str:
    missing_fields = state["missing_fields"]
    if missing_fields == []:
        return "new_data_agent"
    else:
        return "missing_fields_agent"

graph = StateGraph(TravelPlannerState)
graph.add_node("supervisor_agent", supervisor_node)
graph.add_node("missing_fields_agent", missing_fields_node)
graph.add_node("new_data_agent",new_data_agent)
graph.add_node("hotel_planner_agent", hotel_planner_node)
graph.add_node("weather_planner_agent", weather_planner_agent)
graph.add_node("flight_planner_agent", flight_planner_node)


graph.add_edge(START, "supervisor_agent")
graph.add_edge( "supervisor_agent", "missing_fields_agent")
graph.add_conditional_edges("missing_fields_agent",conditional_routing_missing, {
    "missing_fields_agent" : "missing_fields_agent",
    "new_data_agent" : "new_data_agent"
})
graph.add_edge("new_data_agent", END)

checkpointer = InMemorySaver()

graph_compile = graph.compile(checkpointer = checkpointer)

def process_travel_planner(user_id, user_message):
    config = {"configurable": {"thread_id": user_id}}

    snapshot = graph_compile.get_state(config)
    is_waiting = bool(snapshot.next) and any(t.interrupts for t in snapshot.tasks)

    if is_waiting:
        return graph_compile.invoke(Command(resume=user_message), config=config)

    initial_state = {"messages": [HumanMessage(content=user_message)]}
    return graph_compile.invoke(initial_state, config=config)


