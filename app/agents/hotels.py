from app.schemas.travel_planner import TravelPlannerState


def hotel_planner_node(state: TravelPlannerState) -> TravelPlannerState:
    print("hotel_planner_node")
    return {}