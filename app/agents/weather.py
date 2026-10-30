from app.schemas.travel_planner import TravelPlannerState


def weather_planner_node(state: TravelPlannerState) -> TravelPlannerState:
    print("weather_planner_node")
    return {}