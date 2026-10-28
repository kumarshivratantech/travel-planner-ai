from app.agents.intake import process_travel_planner


def start_process_travel_planner():
    result = process_travel_planner(
        user_id="user_101",
        user_message="Plan a 5-day trip Bangalore to Goa with flights and hotels. From 10 Nov 2026 to 15 Nov 2026 for me and my wife"
    )
    print(result)

start_process_travel_planner()

