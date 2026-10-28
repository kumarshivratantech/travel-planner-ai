from typing import Annotated, Optional, ClassVar
from datetime import date
from pydantic import BaseModel, Field


class TripPreferences(BaseModel):
    user_message : Annotated[Optional[str], Field(min_length= 10, max_length=2000, description= "User send a message request", default= None)]
    source : Annotated[Optional[str], Field(min_length= 3, max_length=100, description= "Source location, From where will start his/her journey", default= None)]
    stop_location : Annotated[Optional[list[str]], Field(max_length=100, description= "Stop location, which stop it he/she will be stop,in travel order, origin not included", default= None)]
    return_to_base : Annotated[Optional[bool], Field(description= "Return to base", default= None)]
    days_of_itinerary : Optional[int] = None
    adults : Optional[int]= None
    children : Optional[int]= None
    no_of_old_ages : Optional[int]= None
    budget : Optional[int|float]= None
    start_date: Optional[date] =None
    end_date: Optional[date] = None
    currency: Optional[str] = "INR"

    REQUIRED_FIELD: ClassVar[list[str]] = [
        "source", "stop_location", "return_to_base", "start_date", "adults", "end_date"
    ]

    def missing_fields(self) -> list[str]:
        return [f for f in self.REQUIRED_FIELD if getattr(self, f) is None]


