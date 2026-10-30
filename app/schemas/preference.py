from typing import Annotated, Optional, ClassVar
from datetime import date, timedelta
from pydantic import BaseModel, Field, field_validator, model_validator

PLACEHOLDERS = {"<unknown>", "unknown", "n/a", "none", "null", "", "not specified"}
class TripPreferences(BaseModel):
    user_message : Annotated[Optional[str], Field(min_length= 10, max_length=2000, description= "User send a message request", default= None)]
    source : Annotated[Optional[str], Field(min_length= 3, max_length=100, description= "Source location, From where will start his/her journey", default= None)]
    stop_location : Annotated[Optional[list[str]], Field(max_length=100, description= "Stop location, which stop it he/she will be stop,in travel order, origin not included", default= None)]
    return_to_base : Annotated[Optional[bool], Field(description= "Return to base", default= None)]
    days_of_itinerary : Optional[int] = None
    adults : Optional[int]= Field(None, description="Number of adults.Use null if not stated.")
    children : Optional[int]= Field(None, description="Number of children. Use null if not stated.")
    no_of_old_ages : Optional[int]= None
    budget : Optional[int|float]= None
    start_date: Optional[date] =None
    end_date: Optional[date] = None
    currency: Optional[str] = "INR"

    @model_validator(mode="after")
    def derive_end_date(self):
        if self.end_date is None and self.start_date and self.days_of_itinerary:
            self.end_date = self.start_date + timedelta(days=self.days_of_itinerary - 1)
        return self

    @field_validator("*", mode="before")
    @classmethod
    def blank_placeholders(cls, v):
        if isinstance(v, str) and v.strip().lower() in PLACEHOLDERS:
            return None
        return v

    REQUIRED_FIELD: ClassVar[list[str]] = [
        "source", "stop_location", "return_to_base", "start_date", "adults"
    ]

    def missing_fields(self) -> list[str]:
        return [f for f in self.REQUIRED_FIELD if getattr(self, f) is None]


