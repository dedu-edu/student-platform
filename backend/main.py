import os
import uuid
from urllib.parse import quote

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
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
    LabResponse
)
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_school_admin,
    get_current_platform_admin
)
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


@app.get("/")
def root():
    return {"message": "The Eden API is running"}


# ---------------------------------------------------------------- auth

@app.post("/register", response_model=UserResponse)
def register(
    user: UserCreate,
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
    db.commit()
    db.refresh(new_user)

    return new_user


@app.post("/login", response_model=Token)
def login(
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

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }


@app.get("/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user)
):
    return current_user


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

    db.delete(item)
    db.commit()

    return {"message": "Email removed from allowlist"}


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

    stored_files = [lab.filename for lab in labs]

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
        teacher_id=lab_teacher_for(subject, lab)
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

    stored_filename = lab.filename

    db.delete(lab)
    db.commit()

    remove_files([stored_filename])

    return {"message": "Lab deleted successfully"}


@app.post("/admin/labs/{lab_id}/upload")
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

    stored_filename = (
        f"{uuid.uuid4().hex}_{original_filename}"
    )

    file_data = await file.read()

    try:
        supabase.storage.from_(SUPABASE_BUCKET).upload(
            stored_filename,
            file_data,
            {
                "content-type": file.content_type or "application/octet-stream",
                "upsert": "false"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload file: {str(e)}"
        )

    lab.filename = stored_filename

    db.commit()
    db.refresh(lab)

    return {
        "message": "File uploaded successfully",
        "filename": original_filename
    }


@app.put("/admin/labs/{lab_id}/file")
async def update_lab_file(
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

    old_filename = lab.filename

    original_filename = os.path.basename(file.filename)

    stored_filename = (
        f"{uuid.uuid4().hex}_{original_filename}"
    )

    file_data = await file.read()

    try:
        supabase.storage.from_(SUPABASE_BUCKET).upload(
            stored_filename,
            file_data,
            {
                "content-type": file.content_type or "application/octet-stream",
                "upsert": "false"
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload file: {str(e)}"
        )

    lab.filename = stored_filename

    db.commit()
    db.refresh(lab)

    remove_files([old_filename])

    return {
        "message": "File updated successfully",
        "filename": original_filename
    }


@app.get("/labs/{lab_id}/download")
def download_lab_file(
    lab_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = get_visible_lab(db, current_user, lab_id)

    if not lab.filename:
        raise HTTPException(
            status_code=404,
            detail="This lab does not have a file"
        )

    try:
        file_data = supabase.storage.from_(
            SUPABASE_BUCKET
        ).download(lab.filename)
    except Exception:
        raise HTTPException(
            status_code=404,
            detail="File not found"
        )

    if not file_data:
        raise HTTPException(
            status_code=404,
            detail="File not found"
        )

    if "_" in lab.filename:
        original_filename = lab.filename.split("_", 1)[1]
    else:
        original_filename = lab.filename

    # headers must be latin-1, so non-Latin names (e.g. Cyrillic) go in
    # filename* (RFC 6266) with a plain ASCII fallback in filename
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