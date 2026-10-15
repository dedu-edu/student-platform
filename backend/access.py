"""
One place for "who can see / change what".

Every route goes through these helpers instead of querying tables directly,
so a school can never see another school's data by accident.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from models import User
from roles import ROLE_PLATFORM_ADMIN


def visible_subjects(db: Session, user: User):
    """Subjects the user may SEE: their own school's (platform admin: all)."""
    query = db.query(models.Subject)

    if user.role == ROLE_PLATFORM_ADMIN:
        return query

    return query.filter(models.Subject.school_id == user.school_id)


def get_visible_subject(db: Session, user: User, subject_id: int):
    subject = visible_subjects(db, user).filter(
        models.Subject.id == subject_id
    ).first()

    # 404 (not 403) so other schools' ids are not revealed
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    return subject


def visible_labs(db: Session, user: User):
    return db.query(models.Lab).join(models.Subject).filter(
        models.Subject.id.in_(
            visible_subjects(db, user).with_entities(models.Subject.id)
        )
    )


def get_visible_lab(db: Session, user: User, lab_id: int):
    lab = db.query(models.Lab).filter(models.Lab.id == lab_id).first()

    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    # raises 404 if the lab's subject belongs to another school
    get_visible_subject(db, user, lab.subject_id)

    return lab


def visible_teachers(db: Session, user: User):
    query = db.query(models.Teacher)

    if user.role == ROLE_PLATFORM_ADMIN:
        return query

    return query.filter(models.Teacher.school_id == user.school_id)


def get_visible_teacher(db: Session, user: User, teacher_id: int):
    teacher = visible_teachers(db, user).filter(
        models.Teacher.id == teacher_id
    ).first()

    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    return teacher


def get_school_user(db: Session, actor: User, user_id: int):
    """A user the actor (school admin / platform admin) may manage."""
    query = db.query(User).filter(User.id == user_id)

    if actor.role != ROLE_PLATFORM_ADMIN:
        query = query.filter(User.school_id == actor.school_id)

    target = query.first()

    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    return target


def resolve_school_id(actor: User, requested_school_id: int | None):
    """
    Which school an admin action applies to.
    School admins are locked to their own school.
    The platform admin may pick one (or falls back to their own).
    """
    if actor.role == ROLE_PLATFORM_ADMIN:
        school_id = requested_school_id or actor.school_id

        if school_id is None:
            raise HTTPException(
                status_code=400,
                detail="school_id is required"
            )

        return school_id

    if requested_school_id and requested_school_id != actor.school_id:
        raise HTTPException(
            status_code=403,
            detail="You can only work inside your own school"
        )

    return actor.school_id


def require_school(db: Session, school_id: int):
    school = db.query(models.School).filter(
        models.School.id == school_id
    ).first()

    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    return school


def resolve_teachers(db: Session, school_id: int, teacher_ids: list[int]):
    """A subject's teachers must belong to the same school."""
    ids = set(teacher_ids)

    if not ids:
        return []

    teachers = db.query(models.Teacher).filter(
        models.Teacher.id.in_(ids),
        models.Teacher.school_id == school_id
    ).all()

    if len(teachers) != len(ids):
        raise HTTPException(
            status_code=400,
            detail="Teachers must belong to the same school"
        )

    return teachers


def check_lab_teacher(subject, teacher_id: int | None):
    """A lab's teacher must be one of its subject's teachers."""
    if teacher_id is not None and not subject.has_teacher(teacher_id):
        raise HTTPException(
            status_code=400,
            detail="That teacher does not teach this subject"
        )
