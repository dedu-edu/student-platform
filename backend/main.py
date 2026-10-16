import os
import secrets
import uuid
from urllib.parse import quote

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import Response
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session
from supabase import create_client, Client

from database import engine, Base, get_db
import models
from models import User
from roles import (
    ASSIGNABLE_ROLES,
    ROLE_STUDENT,
    ROLE_SCHOOL_ADMIN,
    ROLE_PLATFORM_ADMIN,
)
from schemas import (
    UserCreate,
    UserResponse,
    PasswordChange,
    PasswordReset,
    RoleUpdate,
    SchoolUpdate,
    SchoolCreate,
    SchoolResponse,
    TeacherCreate,
    TeacherResponse,
    Token,
    AllowedEmailCreate,
    AllowedEmailResponse,
    SubjectCreate,
    SubjectUpdate,
    SubjectResponse,
    LabCreate,
    LabResponse,
    ActivityResponse,
    UserActivitySummary,
    SubmissionResponse,
    LabSubmissionRow
)
from activity import (
    log_event,
    EVENT_REGISTER,
    EVENT_LOGIN,
    EVENT_LOGOUT,
    EVENT_DOWNLOAD,
    EVENT_SUBMIT,
    EVENT_VIEW,
    EVENT_PASSWORD_RESET,
    EVENT_PASSWORD_CHANGE
)
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_school_admin,
    get_current_platform_admin
)
from previews import preview_type
from access import (
    visible_subjects,
    get_visible_subject,
    visible_labs,
    get_visible_lab,
    visible_teachers,
    get_visible_teacher,
    get_school_user,
    resolve_school_id,
    require_school,
    resolve_teachers,
    check_lab_teacher
)

Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://student-platform-orcin.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "labs")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_KEY environment variables are required"
    )

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


def remove_files(filenames):
    """Best effort: a storage hiccup must never fail a request."""
    names = [name for name in filenames if name]

    if not names:
        return

    try:
        supabase.storage.from_(SUPABASE_BUCKET).remove(names)
    except Exception:
        pass


def file_response(file_data: bytes, original_filename: str):
    """Send a file as a download, keeping non-Latin (e.g. Cyrillic) names."""
    # headers must be latin-1, so the real name goes in filename* (RFC 6266)
    # with a plain ASCII fallback in filename
    ascii_filename = (
        original_filename.encode("ascii", "replace").decode("ascii")
        .replace("?", "_").replace('"', "_")
    )

    return Response(
        content=file_data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_filename}"; '
                f"filename*=UTF-8''{quote(original_filename)}"
            )
        }
    )


def download_stored_file(stored_filename: str) -> bytes:
    try:
        file_data = supabase.storage.from_(SUPABASE_BUCKET).download(
            stored_filename
        )
    except Exception:
        file_data = None

    if not file_data:
        raise HTTPException(status_code=404, detail="File not found")

    return file_data


def submission_files(db: Session, *conditions):
    """Delete matching submissions; return their stored files to remove after commit."""
    query = db.query(models.Submission).filter(*conditions)
    files = [submission.filename for submission in query.all()]
    query.delete(synchronize_session=False)
    return files


@app.get("/")
def root():
    return {"message": "The Eden API is running"}


# ---------------------------------------------------------------- auth

@app.post("/register", response_model=UserResponse)
def register(
    user: UserCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    email = user.email.lower().strip()

    allowed_email = db.query(models.AllowedEmail).filter(
        models.AllowedEmail.email == email
    ).first()

    if not allowed_email:
        raise HTTPException(
            status_code=403,
            detail="This email has not been approved"
        )

    existing_user = db.query(User).filter(
        (User.username == user.username) |
        (User.email == email)
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username or email already exists"
        )

    # school and role come from the allowlist, never from the person registering
    new_user = User(
        username=user.username,
        email=email,
        password_hash=hash_password(user.password),
        role=allowed_email.role,
        school_id=allowed_email.school_id
    )

    db.add(new_user)
    db.flush()
    log_event(db, new_user, EVENT_REGISTER, request)
    db.commit()
    db.refresh(new_user)

    return new_user


@app.post("/login", response_model=Token)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.username == form_data.username
    ).first()

    if not user or not verify_password(
        form_data.password,
        user.password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password"
        )

    access_token = create_access_token(
        data={"sub": user.username}
    )

    log_event(db, user, EVENT_LOGIN, request)
    db.commit()

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@app.post("/logout")
def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # the token itself just expires; this only records the logout
    log_event(db, current_user, EVENT_LOGOUT, request)
    db.commit()

    return {"message": "Logged out"}


@app.get("/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user)
):
    return current_user


MIN_PASSWORD_LENGTH = 8

# no 0/O, 1/l/I: the admin reads the temporary password out to the student
TEMP_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


@app.post("/me/password")
def change_my_password(
    data: PasswordChange,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=400,
            detail="Current password is incorrect"
        )

    if len(data.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )

    if data.new_password == data.current_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different"
        )

    current_user.password_hash = hash_password(data.new_password)
    current_user.must_change_password = False
    log_event(db, current_user, EVENT_PASSWORD_CHANGE, request)
    db.commit()

    return {"message": "Password changed"}


# ------------------------------------------------- platform: schools

@app.get("/platform/schools", response_model=list[SchoolResponse])
def list_schools(
    current_admin: User = Depends(get_current_platform_admin),
    db: Session = Depends(get_db)
):
    return db.query(models.School).order_by(models.School.name).all()


@app.post("/platform/schools", response_model=SchoolResponse)
def create_school(
    data: SchoolCreate,
    current_admin: User = Depends(get_current_platform_admin),
    db: Session = Depends(get_db)
):
    name = data.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="School name cannot be empty"
        )

    if db.query(models.School).filter(models.School.name == name).first():
        raise HTTPException(
            status_code=400,
            detail="School already exists"
        )

    school = models.School(name=name)

    db.add(school)
    db.commit()
    db.refresh(school)

    return school


@app.put("/platform/schools/{school_id}", response_model=SchoolResponse)
def rename_school(
    school_id: int,
    data: SchoolCreate,
    current_admin: User = Depends(get_current_platform_admin),
    db: Session = Depends(get_db)
):
    school = require_school(db, school_id)
    name = data.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="School name cannot be empty"
        )

    duplicate = db.query(models.School).filter(
        models.School.name == name,
        models.School.id != school_id
    ).first()

    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="School already exists"
        )

    school.name = name
    db.commit()
    db.refresh(school)

    return school


# ------------------------------------------------------------- users

@app.get("/users", response_model=list[UserResponse])
def get_users(
    school_id: int | None = None,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = db.query(User)

    if current_admin.role == ROLE_PLATFORM_ADMIN:
        if school_id:
            query = query.filter(User.school_id == school_id)
    else:
        query = query.filter(User.school_id == current_admin.school_id)

    return query.order_by(User.username).all()


def change_user_role(
    db: Session,
    actor: User,
    user_id: int,
    new_role: str
):
    if new_role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    target = get_school_user(db, actor, user_id)

    if target.id == actor.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot change your own role"
        )

    if target.role == ROLE_PLATFORM_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Platform admins can only be changed in the database"
        )

    target.role = new_role
    db.commit()
    db.refresh(target)

    return target


@app.put("/admin/users/{user_id}/role", response_model=UserResponse)
def set_user_role(
    user_id: int,
    data: RoleUpdate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    return change_user_role(db, current_admin, user_id, data.role)


def check_can_delete(actor: User, target: User):
    if target.id == actor.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own account"
        )

    if target.role == ROLE_PLATFORM_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Platform admins can only be changed in the database"
        )


@app.post("/admin/users/{user_id}/reset-password", response_model=PasswordReset)
def reset_user_password(
    user_id: int,
    request: Request,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    target = get_school_user(db, current_admin, user_id)

    if target.id == current_admin.id:
        raise HTTPException(
            status_code=400,
            detail="Change your own password from your account instead"
        )

    if target.role == ROLE_PLATFORM_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Platform admins can only be changed in the database"
        )

    temporary_password = "".join(
        secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(10)
    )

    # the student must replace it the next time they log in
    target.password_hash = hash_password(temporary_password)
    target.must_change_password = True
    log_event(
        db, target, EVENT_PASSWORD_RESET, request,
        detail=current_admin.username  # who reset it
    )
    db.commit()

    return {"temporary_password": temporary_password}


def delete_account(db: Session, target: User):
    """
    Remove a user, their log rows, submissions and allowlist entry. The caller
    commits, then removes the returned stored files.
    """
    files = submission_files(db, models.Submission.user_id == target.id)
    db.query(models.ActivityLog).filter(
        models.ActivityLog.user_id == target.id
    ).delete(synchronize_session=False)
    db.query(models.AllowedEmail).filter(
        models.AllowedEmail.email == target.email
    ).delete(synchronize_session=False)
    db.delete(target)
    return files


@app.delete("/admin/users/{user_id}")
def delete_user(
    user_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    # the allowlist entry goes too, so the person cannot simply register again
    target = get_school_user(db, current_admin, user_id)
    check_can_delete(current_admin, target)

    username = target.username
    files = delete_account(db, target)
    db.commit()
    remove_files(files)

    return {"message": "User deleted", "username": username}


@app.put("/platform/users/{user_id}/school", response_model=UserResponse)
def move_user_to_school(
    user_id: int,
    data: SchoolUpdate,
    current_admin: User = Depends(get_current_platform_admin),
    db: Session = Depends(get_db)
):
    target = get_school_user(db, current_admin, user_id)
    require_school(db, data.school_id)

    target.school_id = data.school_id

    # keep the allowlist entry in step, so it matches where the person is
    db.query(models.AllowedEmail).filter(
        models.AllowedEmail.email == target.email
    ).update({"school_id": data.school_id}, synchronize_session=False)

    db.commit()
    db.refresh(target)

    return target


# legacy endpoints, kept so the current frontend keeps working
@app.put("/admin/users/{user_id}/make-admin")
def make_user_admin(
    user_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    user = change_user_role(db, current_admin, user_id, ROLE_SCHOOL_ADMIN)

    return {"message": "User is now an admin", "username": user.username}


@app.put("/admin/users/{user_id}/remove-admin")
def remove_user_admin(
    user_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    user = change_user_role(db, current_admin, user_id, ROLE_STUDENT)

    return {"message": "Admin access removed", "username": user.username}


# ---------------------------------------------------- allowed emails

@app.get("/admin/allowed-emails", response_model=list[AllowedEmailResponse])
def get_allowed_emails(
    school_id: int | None = None,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = db.query(models.AllowedEmail)

    if current_admin.role == ROLE_PLATFORM_ADMIN:
        if school_id:
            query = query.filter(models.AllowedEmail.school_id == school_id)
    else:
        query = query.filter(
            models.AllowedEmail.school_id == current_admin.school_id
        )

    return query.order_by(models.AllowedEmail.email).all()


@app.post("/admin/allowed-emails", response_model=AllowedEmailResponse)
def add_allowed_email(
    data: AllowedEmailCreate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    email = data.email.lower().strip()

    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    if data.role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    if db.query(models.AllowedEmail).filter(
        models.AllowedEmail.email == email
    ).first():
        raise HTTPException(
            status_code=400,
            detail="Email is already allowed"
        )

    school_id = resolve_school_id(current_admin, data.school_id)
    require_school(db, school_id)

    allowed_email = models.AllowedEmail(
        email=email,
        role=data.role,
        school_id=school_id
    )

    db.add(allowed_email)
    db.commit()
    db.refresh(allowed_email)

    return allowed_email


@app.delete("/admin/allowed-emails/{email_id}")
def delete_allowed_email(
    email_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = db.query(models.AllowedEmail).filter(
        models.AllowedEmail.id == email_id
    )

    if current_admin.role != ROLE_PLATFORM_ADMIN:
        query = query.filter(
            models.AllowedEmail.school_id == current_admin.school_id
        )

    item = query.first()

    if not item:
        raise HTTPException(status_code=404, detail="Email not found")

    # removing someone's email also removes the account they registered with it
    account = db.query(User).filter(User.email == item.email).first()
    files = []

    if account:
        check_can_delete(current_admin, account)
        files = delete_account(db, account)  # removes the allowlist entry too
    else:
        db.delete(item)

    db.commit()
    remove_files(files)

    return {
        "message": "Email removed from allowlist",
        "deleted_user": account.username if account else None
    }


# ---------------------------------------------------------- teachers

@app.get("/admin/teachers", response_model=list[TeacherResponse])
def get_teachers(
    school_id: int | None = None,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = visible_teachers(db, current_admin)

    if current_admin.role == ROLE_PLATFORM_ADMIN and school_id:
        query = query.filter(models.Teacher.school_id == school_id)

    return query.order_by(models.Teacher.name).all()


def clean_teacher_name(db: Session, school_id: int, name: str, teacher_id=None):
    name = name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Teacher name cannot be empty"
        )

    duplicate = db.query(models.Teacher).filter(
        models.Teacher.school_id == school_id,
        models.Teacher.name == name,
        models.Teacher.id != teacher_id
    ).first()

    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="Teacher already exists"
        )

    return name


@app.post("/admin/teachers", response_model=TeacherResponse)
def create_teacher(
    data: TeacherCreate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    school_id = resolve_school_id(current_admin, data.school_id)
    require_school(db, school_id)

    teacher = models.Teacher(
        name=clean_teacher_name(db, school_id, data.name),
        school_id=school_id
    )

    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    return teacher


@app.put("/admin/teachers/{teacher_id}", response_model=TeacherResponse)
def rename_teacher(
    teacher_id: int,
    data: TeacherCreate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    teacher = get_visible_teacher(db, current_admin, teacher_id)
    teacher.name = clean_teacher_name(
        db, teacher.school_id, data.name, teacher_id
    )

    db.commit()
    db.refresh(teacher)

    return teacher


@app.delete("/admin/teachers/{teacher_id}")
def delete_teacher(
    teacher_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    teacher = get_visible_teacher(db, current_admin, teacher_id)

    # their labs stay, without a teacher, so nothing students use disappears
    db.query(models.Lab).filter(
        models.Lab.teacher_id == teacher_id
    ).update({"teacher_id": None}, synchronize_session=False)
    db.execute(
        models.subject_teachers.delete().where(
            models.subject_teachers.c.teacher_id == teacher_id
        )
    )
    db.delete(teacher)
    db.commit()

    return {"message": "Teacher deleted"}


# ---------------------------------------------------------- subjects
# school -> subject -> teacher -> labs. Admins run everything; teachers are
# just names (they do not log in). A subject has any number of teachers and
# every lab belongs to one of them, so students can browse labs by teacher.

@app.get("/subjects", response_model=list[SubjectResponse])
def get_subjects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return visible_subjects(db, current_user).order_by(
        models.Subject.name
    ).all()


@app.get("/admin/subjects", response_model=list[SubjectResponse])
def get_admin_subjects(
    school_id: int | None = None,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = visible_subjects(db, current_admin)

    if current_admin.role == ROLE_PLATFORM_ADMIN and school_id:
        query = query.filter(models.Subject.school_id == school_id)

    return query.order_by(models.Subject.name).all()


@app.post("/admin/subjects", response_model=SubjectResponse)
def create_subject(
    subject: SubjectCreate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    name = subject.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Subject name cannot be empty"
        )

    school_id = resolve_school_id(current_admin, subject.school_id)
    require_school(db, school_id)

    existing_subject = db.query(models.Subject).filter(
        models.Subject.school_id == school_id,
        models.Subject.name == name
    ).first()

    if existing_subject:
        raise HTTPException(
            status_code=400,
            detail="Subject already exists"
        )

    new_subject = models.Subject(
        name=name,
        school_id=school_id,
        teachers=resolve_teachers(db, school_id, subject.teacher_ids)
    )

    db.add(new_subject)
    db.commit()
    db.refresh(new_subject)

    return new_subject


@app.put("/admin/subjects/{subject_id}", response_model=SubjectResponse)
def update_subject(
    subject_id: int,
    data: SubjectUpdate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    subject = get_visible_subject(db, current_admin, subject_id)

    if data.name is not None:
        new_name = data.name.strip()

        if not new_name:
            raise HTTPException(
                status_code=400,
                detail="Subject name cannot be empty"
            )

        duplicate = db.query(models.Subject).filter(
            models.Subject.school_id == subject.school_id,
            models.Subject.name == new_name,
            models.Subject.id != subject_id
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=400,
                detail="Subject already exists"
            )

        subject.name = new_name

    # a removed teacher's labs stay in the subject; an admin can reassign them
    if data.teacher_ids is not None:
        subject.teachers = resolve_teachers(
            db, subject.school_id, data.teacher_ids
        )

    db.commit()
    db.refresh(subject)

    return subject


@app.delete("/admin/subjects/{subject_id}")
def delete_subject(
    subject_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    subject = get_visible_subject(db, current_admin, subject_id)

    labs = db.query(models.Lab).filter(
        models.Lab.subject_id == subject_id
    ).all()

    lab_ids = [lab.id for lab in labs]
    stored_files = lab_file_names(db, lab_ids)
    stored_files += submission_files(
        db, models.Submission.lab_id.in_(lab_ids)
    )

    db.query(models.Lab).filter(
        models.Lab.subject_id == subject_id
    ).delete(synchronize_session=False)

    subject.teachers = []
    db.delete(subject)
    db.commit()

    remove_files(stored_files)

    return {
        "message": "Subject and its labs deleted successfully"
    }


# -------------------------------------------------------------- labs

@app.get("/subjects/{subject_id}/labs", response_model=list[LabResponse])
def get_subject_labs(
    subject_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    get_visible_subject(db, current_user, subject_id)

    return db.query(models.Lab).filter(
        models.Lab.subject_id == subject_id
    ).order_by(models.Lab.id).all()


@app.get("/labs", response_model=list[LabResponse])
def get_labs(
    school_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Every lab the user can see, for search and the "Шинэ" badges."""
    query = visible_labs(db, current_user)

    # the platform admin previewing the student side looks at one school
    if current_user.role == ROLE_PLATFORM_ADMIN and school_id:
        query = query.filter(models.Subject.school_id == school_id)

    return query.order_by(models.Lab.id).all()


@app.get("/admin/labs", response_model=list[LabResponse])
def get_admin_labs(
    school_id: int | None = None,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = visible_labs(db, current_admin)

    if current_admin.role == ROLE_PLATFORM_ADMIN and school_id:
        query = query.filter(models.Subject.school_id == school_id)

    return query.order_by(models.Lab.id).all()


@app.get("/labs/{lab_id}", response_model=LabResponse)
def get_lab(
    lab_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return get_visible_lab(db, current_user, lab_id)


def lab_teacher_for(subject, lab: LabCreate, existing_lab=None):
    """Which teacher a lab belongs to: one of its subject's teachers, or none."""
    current_teacher = existing_lab.teacher_id if existing_lab else None

    if "teacher_id" not in lab.model_fields_set:
        teacher_id = current_teacher
    else:
        teacher_id = lab.teacher_id

    # only check when something changes, so a lab whose teacher has since
    # left the subject can still be edited
    if (
        existing_lab is None
        or teacher_id != current_teacher
        or subject.id != existing_lab.subject_id
    ):
        check_lab_teacher(subject, teacher_id)

    return teacher_id


@app.post("/admin/labs", response_model=LabResponse)
def create_lab(
    lab: LabCreate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    subject = get_visible_subject(db, current_admin, lab.subject_id)

    title = lab.title.strip()

    if not title:
        raise HTTPException(
            status_code=400,
            detail="Lab title cannot be empty"
        )

    new_lab = models.Lab(
        subject_id=lab.subject_id,
        title=title,
        description=lab.description,
        teacher_id=lab_teacher_for(subject, lab),
        accepts_submissions=lab.accepts_submissions,
        submission_deadline=lab.submission_deadline
    )

    db.add(new_lab)
    db.commit()
    db.refresh(new_lab)

    return new_lab


@app.put("/admin/labs/{lab_id}", response_model=LabResponse)
def update_lab(
    lab_id: int,
    lab: LabCreate,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    existing_lab = get_visible_lab(db, current_admin, lab_id)
    current_subject = get_visible_subject(
        db, current_admin, existing_lab.subject_id
    )
    target_subject = get_visible_subject(
        db, current_admin, lab.subject_id
    )

    if target_subject.school_id != current_subject.school_id:
        raise HTTPException(
            status_code=400,
            detail="A lab cannot be moved to another school"
        )

    title = lab.title.strip()

    if not title:
        raise HTTPException(
            status_code=400,
            detail="Lab title cannot be empty"
        )

    teacher_id = lab_teacher_for(target_subject, lab, existing_lab)

    existing_lab.subject_id = lab.subject_id
    existing_lab.title = title
    existing_lab.description = lab.description
    existing_lab.teacher_id = teacher_id

    if "accepts_submissions" in lab.model_fields_set:
        existing_lab.accepts_submissions = lab.accepts_submissions
    if "submission_deadline" in lab.model_fields_set:
        existing_lab.submission_deadline = lab.submission_deadline

    db.commit()
    db.refresh(existing_lab)

    return existing_lab


@app.delete("/admin/labs/{lab_id}")
def delete_lab(
    lab_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_admin, lab_id)

    stored_files = lab_file_names(db, [lab.id])
    stored_files += submission_files(db, models.Submission.lab_id == lab.id)

    db.delete(lab)
    db.commit()

    remove_files(stored_files)

    return {"message": "Lab deleted successfully"}


def storage_key(folder: str, original_filename: str):
    """A plain-ASCII storage name; the real name is kept in the database."""
    extension = os.path.splitext(original_filename)[1]
    if not (extension[1:].isascii() and extension[1:].isalnum()):
        extension = ""
    return f"{folder}/{uuid.uuid4().hex}{extension}"


def upload_to_storage(stored_filename: str, file_data: bytes, content_type):
    try:
        supabase.storage.from_(SUPABASE_BUCKET).upload(
            stored_filename,
            file_data,
            {
                "content-type": content_type or "application/octet-stream",
                "upsert": "false"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload file: {str(e)}"
        )


def lab_file_names(db: Session, lab_ids):
    """Delete the labs' file rows; return stored files to remove after commit."""
    query = db.query(models.LabFile).filter(models.LabFile.lab_id.in_(lab_ids))
    files = [lab_file.filename for lab_file in query.all()]
    query.delete(synchronize_session=False)
    return files


# a lab can have several files: each upload adds one
@app.post("/admin/labs/{lab_id}/upload", response_model=LabResponse)
async def upload_lab_file(
    lab_id: int,
    file: UploadFile = File(...),
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_admin, lab_id)

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="No filename provided"
        )

    original_filename = os.path.basename(file.filename)
    stored_filename = storage_key(f"labs/{lab.id}", original_filename)
    file_data = await file.read()

    upload_to_storage(stored_filename, file_data, file.content_type)

    db.add(models.LabFile(
        lab_id=lab.id,
        filename=stored_filename,
        original_name=original_filename,
        size=len(file_data)
    ))
    db.commit()
    db.refresh(lab)

    return lab


@app.delete("/admin/labs/{lab_id}/files/{file_id}", response_model=LabResponse)
def delete_lab_file(
    lab_id: int,
    file_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_admin, lab_id)
    lab_file = get_lab_file(db, lab, file_id)

    stored_filename = lab_file.filename
    db.delete(lab_file)
    db.commit()
    db.refresh(lab)

    remove_files([stored_filename])

    return lab


def get_lab_file(db: Session, lab, file_id: int):
    lab_file = db.query(models.LabFile).filter(
        models.LabFile.id == file_id,
        models.LabFile.lab_id == lab.id
    ).first()

    if not lab_file:
        raise HTTPException(status_code=404, detail="File not found")

    return lab_file


@app.get("/labs/{lab_id}/files/{file_id}/download")
def download_lab_file(
    lab_id: int,
    file_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_user, lab_id)
    lab_file = get_lab_file(db, lab, file_id)
    file_data = download_stored_file(lab_file.filename)

    log_event(
        db, current_user, EVENT_DOWNLOAD, request,
        detail=f"{lab.title}: {lab_file.original_name}"
    )
    db.commit()

    return file_response(file_data, lab_file.original_name)


@app.get("/labs/{lab_id}/files/{file_id}/preview")
def preview_lab_file(
    lab_id: int,
    file_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_user, lab_id)
    lab_file = get_lab_file(db, lab, file_id)
    media_type = preview_type(lab_file.original_name)

    if not media_type:
        raise HTTPException(
            status_code=400,
            detail="This file cannot be previewed"
        )

    file_data = download_stored_file(lab_file.filename)

    log_event(
        db, current_user, EVENT_VIEW, request,
        detail=f"{lab.title}: {lab_file.original_name}"
    )
    db.commit()

    return Response(
        content=file_data,
        media_type=media_type,
        headers={"X-Content-Type-Options": "nosniff"}
    )


# ------------------------------------------------------- submissions

MAX_SUBMISSION_BYTES = 10 * 1024 * 1024

# ordinary schoolwork only: no videos, programs, disk images...
SUBMISSION_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt",
    ".ods", ".odp", ".txt", ".md", ".csv", ".rtf",
    ".zip", ".rar", ".7z",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".py", ".ipynb", ".c", ".cpp", ".h", ".java", ".js", ".ts", ".html",
    ".css", ".sql", ".json", ".m", ".r",
}


def check_submissions_open(lab):
    if not lab.accepts_submissions:
        raise HTTPException(
            status_code=403,
            detail="This lab does not take submissions"
        )

    if not lab.submissions_open:
        raise HTTPException(
            status_code=403,
            detail="The deadline for this lab has passed"
        )


def my_submission(db: Session, user: User, lab_id: int):
    return db.query(models.Submission).filter(
        models.Submission.lab_id == lab_id,
        models.Submission.user_id == user.id
    ).first()


@app.get("/labs/{lab_id}/submission", response_model=SubmissionResponse | None)
def get_my_submission(
    lab_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    get_visible_lab(db, current_user, lab_id)

    return my_submission(db, current_user, lab_id)


@app.post("/labs/{lab_id}/submission", response_model=SubmissionResponse)
async def submit_lab(
    lab_id: int,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_user, lab_id)

    if current_user.role != ROLE_STUDENT:
        raise HTTPException(
            status_code=403,
            detail="Only students hand in work"
        )

    check_submissions_open(lab)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    if os.path.splitext(file.filename)[1].lower() not in SUBMISSION_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="This file type is not allowed"
        )

    # never read more than the limit into memory
    file_data = await file.read(MAX_SUBMISSION_BYTES + 1)

    if not file_data:
        raise HTTPException(status_code=400, detail="The file is empty")

    if len(file_data) > MAX_SUBMISSION_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File is too large (max 10 MB)"
        )

    original_filename = os.path.basename(file.filename)
    stored_filename = storage_key(f"submissions/{lab.id}", original_filename)

    upload_to_storage(stored_filename, file_data, file.content_type)

    # handing in again replaces the earlier file
    submission = my_submission(db, current_user, lab.id)
    old_filename = submission.filename if submission else None

    if submission:
        submission.filename = stored_filename
        submission.original_name = original_filename
        submission.updated_at = models.utcnow()
    else:
        submission = models.Submission(
            lab_id=lab.id,
            user_id=current_user.id,
            filename=stored_filename,
            original_name=original_filename
        )
        db.add(submission)

    log_event(
        db, current_user, EVENT_SUBMIT, request,
        detail=f"{lab.title}: {original_filename}"
    )
    db.commit()
    db.refresh(submission)

    remove_files([old_filename])

    return submission


@app.delete("/labs/{lab_id}/submission")
def withdraw_submission(
    lab_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_user, lab_id)
    # after the deadline the hand-in stays as it is
    check_submissions_open(lab)
    submission = my_submission(db, current_user, lab_id)

    if not submission:
        raise HTTPException(status_code=404, detail="Nothing handed in")

    stored_filename = submission.filename
    db.delete(submission)
    db.commit()

    remove_files([stored_filename])

    return {"message": "Submission removed"}


@app.get(
    "/admin/labs/{lab_id}/submissions",
    response_model=list[LabSubmissionRow]
)
def get_lab_submissions(
    lab_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_admin, lab_id)
    school_id = lab_school_id(db, lab)

    # every student of the lab's school, so the admin also sees who is missing
    students = db.query(User).filter(
        User.school_id == school_id,
        User.role == ROLE_STUDENT
    ).order_by(User.username).all()

    submissions = {
        submission.user_id: submission
        for submission in db.query(models.Submission).filter(
            models.Submission.lab_id == lab.id
        ).all()
    }

    # someone who handed in and later moved school still shows up
    student_ids = {student.id for student in students}
    students += [
        submission.user for user_id, submission in submissions.items()
        if user_id not in student_ids and submission.user
    ]

    return [
        LabSubmissionRow(
            user_id=student.id,
            username=student.username,
            email=student.email,
            submission=submissions.get(student.id)
        )
        for student in students
    ]


def lab_school_id(db: Session, lab):
    return db.query(models.Subject.school_id).filter(
        models.Subject.id == lab.subject_id
    ).scalar()


@app.get("/admin/submissions/{submission_id}/download")
def download_submission(
    submission_id: int,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    submission = db.query(models.Submission).filter(
        models.Submission.id == submission_id
    ).first()

    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    # raises 404 if the lab belongs to another school
    get_visible_lab(db, current_admin, submission.lab_id)

    file_data = download_stored_file(submission.filename)
    username = submission.user.username if submission.user else "student"

    return file_response(file_data, f"{username}_{submission.original_name}")


# ---------------------------------------------------------- activity log

def activity_school_filter(query, column, current_admin: User, school_id):
    """School admins see their own school; the platform admin picks one."""
    if current_admin.role == ROLE_PLATFORM_ADMIN:
        return query.filter(column == school_id) if school_id else query

    return query.filter(column == current_admin.school_id)


@app.get("/admin/activity", response_model=list[ActivityResponse])
def get_activity(
    school_id: int | None = None,
    user_id: int | None = None,
    event: str | None = None,
    limit: int = 500,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    query = activity_school_filter(
        db.query(models.ActivityLog),
        models.ActivityLog.school_id,
        current_admin,
        school_id
    )

    if user_id:
        query = query.filter(models.ActivityLog.user_id == user_id)

    if event:
        query = query.filter(models.ActivityLog.event == event)

    return query.order_by(
        models.ActivityLog.created_at.desc(),
        models.ActivityLog.id.desc()
    ).limit(min(max(limit, 1), 5000)).all()


@app.get("/admin/activity/users", response_model=list[UserActivitySummary])
def get_activity_users(
    school_id: int | None = None,
    current_admin: User = Depends(get_current_school_admin),
    db: Session = Depends(get_db)
):
    users = activity_school_filter(
        db.query(User), User.school_id, current_admin, school_id
    ).order_by(User.username).all()

    ids = [user.id for user in users]
    log = models.ActivityLog

    def latest(event):
        return dict(
            db.query(log.user_id, func.max(log.created_at))
            .filter(log.user_id.in_(ids), log.event == event)
            .group_by(log.user_id)
            .all()
        )

    last_login = latest(EVENT_LOGIN)
    last_logout = latest(EVENT_LOGOUT)
    downloads = dict(
        db.query(log.user_id, func.count(log.id))
        .filter(log.user_id.in_(ids), log.event == EVENT_DOWNLOAD)
        .group_by(log.user_id)
        .all()
    )

    # device of each user's most recent event
    newest_ids = (
        db.query(func.max(log.id))
        .filter(log.user_id.in_(ids), log.device.isnot(None))
        .group_by(log.user_id)
    )
    last_device = dict(
        db.query(log.user_id, log.device).filter(log.id.in_(newest_ids)).all()
    )

    return [
        UserActivitySummary(
            id=user.id,
            username=user.username,
            email=user.email,
            role=user.role,
            created_at=user.created_at,
            last_login_at=last_login.get(user.id),
            last_logout_at=last_logout.get(user.id),
            last_seen_at=user.last_seen_at,
            last_device=last_device.get(user.id),
            downloads=downloads.get(user.id, 0),
        )
        for user in users
    ]
