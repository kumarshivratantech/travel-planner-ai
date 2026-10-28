from langgraph.checkpoint.memory import InMemorySaver
from langgraph.constants import START, END
from langgraph.graph import StateGraph

from app.agents.superagent import SupervisorAgent

from app.schemas.travel_planner import TravelPlannerState

graph = StateGraph(TravelPlannerState)
graph.add_node("supervisor_agent", SupervisorAgent)
graph.add_edge(START, "supervisor_agent")
graph.add_edge("supervisor_agent", END)

checkpointer = InMemorySaver()

graph_compile = graph.compile(checkpointer = checkpointer)


def process_travel_planner(user_id, user_message):
    config = {"configurable": {"thread_id": user_id}}
    initial_state = {
        "messages": user_message
    }
    result_response = graph_compile.invoke(initial_state, config=config)
    return result_response;
