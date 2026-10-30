from app.schemas.travel_planner import TravelPlannerState


def flight_planner_node(state: TravelPlannerState) -> TravelPlannerState:
    print("flight_planner_node")
    return {}