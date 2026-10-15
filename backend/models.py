from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint, Table
from sqlalchemy.orm import relationship

from database import Base
from roles import ADMIN_ROLES, ROLE_STUDENT


class School(Base):
    __tablename__ = "schools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)


class Teacher(Base):
    """A teacher's name in a school. Teachers do not log in."""
    __tablename__ = "teachers"
    __table_args__ = (
        UniqueConstraint("school_id", "name", name="teachers_school_name_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default=ROLE_STUDENT)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=True)

    school = relationship("School")

    @property
    def school_name(self):
        return self.school.name if self.school else None

    @property
    def is_admin(self):
        # kept so the existing frontend keeps working: "has an admin dashboard"
        return self.role in ADMIN_ROLES


class AllowedEmail(Base):
    __tablename__ = "allowed_emails"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False)
    role = Column(String, nullable=False, default=ROLE_STUDENT)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)


# school -> subject -> teacher -> labs: a subject can have several teachers
subject_teachers = Table(
    "subject_teachers",
    Base.metadata,
    Column(
        "subject_id",
        Integer,
        ForeignKey("subjects.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "teacher_id",
        Integer,
        ForeignKey("teachers.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (
        UniqueConstraint("school_id", "name", name="subjects_school_name_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)

    teachers = relationship(
        "Teacher",
        secondary=subject_teachers,
        order_by="Teacher.name",
    )

    def has_teacher(self, teacher_id):
        return any(teacher.id == teacher_id for teacher in self.teachers)


class Lab(Base):
    __tablename__ = "labs"

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(String)
    filename = Column(String)
    # the teacher whose lab this is, inside its subject
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )

    teacher = relationship("Teacher")

    @property
    def teacher_name(self):
        return self.teacher.name if self.teacher else None