from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    school_id: int | None = None
    school_name: str | None = None
    is_admin: bool

    class Config:
        from_attributes = True


class RoleUpdate(BaseModel):
    role: str


class SchoolUpdate(BaseModel):
    school_id: int


class SchoolCreate(BaseModel):
    name: str


class SchoolResponse(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class TeacherCreate(BaseModel):
    name: str
    school_id: int | None = None


class TeacherResponse(BaseModel):
    id: int
    name: str
    school_id: int

    class Config:
        from_attributes = True


class SubjectCreate(BaseModel):
    name: str
    school_id: int | None = None
    teacher_ids: list[int] = []


class SubjectUpdate(BaseModel):
    name: str | None = None
    # when sent, replaces the subject's whole teacher list
    teacher_ids: list[int] | None = None


class SubjectResponse(BaseModel):
    id: int
    name: str
    school_id: int
    teachers: list[TeacherResponse] = []

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


class AllowedEmailCreate(BaseModel):
    email: str
    role: str = "student"
    school_id: int | None = None


class AllowedEmailResponse(BaseModel):
    id: int
    email: str
    role: str
    school_id: int

    class Config:
        from_attributes = True


class LabCreate(BaseModel):
    subject_id: int
    title: str
    description: str = ""
    # which of the subject's teachers the lab belongs to
    teacher_id: int | None = None


class LabResponse(BaseModel):
    id: int
    subject_id: int
    title: str
    description: str | None = None
    filename: str | None = None
    teacher_id: int | None = None
    teacher_name: str | None = None

    class Config:
        from_attributes = True