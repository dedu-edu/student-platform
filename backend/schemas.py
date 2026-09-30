from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    is_admin: bool

    class Config:
        from_attributes = True

class SubjectCreate(BaseModel):
    name: str

class SubjectResponse(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class AllowedEmailCreate(BaseModel):
    email: str

class LabCreate(BaseModel):
    subject_id: int
    title: str
    description: str

class LabResponse(BaseModel):
    id: int
    subject_id: int
    title: str
    description: str | None = None
    filename: str | None = None

    class Config:
        from_attributes = True