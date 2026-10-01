import os
import uuid

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from supabase import create_client, Client

from database import engine, Base, get_db
import models
from models import User
from schemas import (
    UserCreate,
    UserResponse,
    Token,
    AllowedEmailCreate,
    SubjectCreate,
    SubjectResponse,
    LabCreate,
    LabResponse
)
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_admin
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


@app.get("/")
def root():
    return {"message": "Student Platform API is running"}


@app.get("/users")
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()


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

    new_user = User(
        username=user.username,
        email=email,
        password_hash=hash_password(user.password)
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

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password"
        )

    if not verify_password(
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


@app.post("/admin/allowed-emails")
def add_allowed_email(
    data: AllowedEmailCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    email = data.email.lower().strip()

    existing = db.query(models.AllowedEmail).filter(
        models.AllowedEmail.email == email
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Email is already allowed"
        )

    allowed_email = models.AllowedEmail(
        email=email
    )

    db.add(allowed_email)
    db.commit()
    db.refresh(allowed_email)

    return {
        "message": "Email added to allowlist",
        "email": email
    }


@app.get("/admin/allowed-emails")
def get_allowed_emails(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    return db.query(models.AllowedEmail).all()


@app.get("/subjects", response_model=list[SubjectResponse])
def get_subjects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return db.query(models.Subject).all()


@app.post("/admin/subjects", response_model=SubjectResponse)
def create_subject(
    subject: SubjectCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    existing_subject = db.query(models.Subject).filter(
        models.Subject.name == subject.name
    ).first()

    if existing_subject:
        raise HTTPException(
            status_code=400,
            detail="Subject already exists"
        )

    new_subject = models.Subject(
        name=subject.name
    )

    db.add(new_subject)
    db.commit()
    db.refresh(new_subject)

    return new_subject


@app.post("/admin/labs", response_model=LabResponse)
def create_lab(
    lab: LabCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    subject = db.query(models.Subject).filter(
        models.Subject.id == lab.subject_id
    ).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found"
        )

    new_lab = models.Lab(
        subject_id=lab.subject_id,
        title=lab.title,
        description=lab.description
    )

    db.add(new_lab)
    db.commit()
    db.refresh(new_lab)

    return new_lab


@app.get("/subjects/{subject_id}/labs", response_model=list[LabResponse])
def get_subject_labs(
    subject_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    subject = db.query(models.Subject).filter(
        models.Subject.id == subject_id
    ).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found"
        )

    return db.query(models.Lab).filter(
        models.Lab.subject_id == subject_id
    ).all()


@app.get("/labs/{lab_id}", response_model=LabResponse)
def get_lab(
    lab_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = db.query(models.Lab).filter(
        models.Lab.id == lab_id
    ).first()

    if not lab:
        raise HTTPException(
            status_code=404,
            detail="Lab not found"
        )

    return lab


@app.post("/admin/labs/{lab_id}/upload")
async def upload_lab_file(
    lab_id: int,
    file: UploadFile = File(...),
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    lab = db.query(models.Lab).filter(
        models.Lab.id == lab_id
    ).first()

    if not lab:
        raise HTTPException(
            status_code=404,
            detail="Lab not found"
        )

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="No filename provided"
        )

    original_filename = os.path.basename(file.filename)

    stored_filename = (
        f"{uuid.uuid4().hex}_{original_filename}"
    )

    file_path = stored_filename

    file_data = await file.read()

    try:
        supabase.storage.from_(SUPABASE_BUCKET).upload(
            file_path,
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


@app.get("/labs/{lab_id}/download")
def download_lab_file(
    lab_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    lab = db.query(models.Lab).filter(
        models.Lab.id == lab_id
    ).first()

    if not lab:
        raise HTTPException(
            status_code=404,
            detail="Lab not found"
        )

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

    return Response(
        content=file_data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{original_filename}"'
            )
        }
    )


@app.put("/admin/labs/{lab_id}", response_model=LabResponse)
def update_lab(
    lab_id: int,
    lab: LabCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    existing_lab = db.query(models.Lab).filter(
        models.Lab.id == lab_id
    ).first()

    if not existing_lab:
        raise HTTPException(
            status_code=404,
            detail="Lab not found"
        )

    subject = db.query(models.Subject).filter(
        models.Subject.id == lab.subject_id
    ).first()

    if not subject:
        raise HTTPException(
            status_code=404,
            detail="Subject not found"
        )

    existing_lab.subject_id = lab.subject_id
    existing_lab.title = lab.title
    existing_lab.description = lab.description

    db.commit()
    db.refresh(existing_lab)

    return existing_lab


@app.put("/admin/labs/{lab_id}/file")
async def update_lab_file(
    lab_id: int,
    file: UploadFile = File(...),
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    lab = db.query(models.Lab).filter(
        models.Lab.id == lab_id
    ).first()

    if not lab:
        raise HTTPException(
            status_code=404,
            detail="Lab not found"
        )

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

    if old_filename:
        try:
            supabase.storage.from_(
                SUPABASE_BUCKET
            ).remove([old_filename])
        except Exception:
            pass

    lab.filename = stored_filename

    db.commit()
    db.refresh(lab)

    return {
        "message": "File updated successfully",
        "filename": original_filename
    }

@app.put("/admin/users/{user_id}/make-admin")
def make_user_admin(
    user_id: int,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(
        User.id == user_id
    ).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    user.is_admin = True

    db.commit()
    db.refresh(user)

    return {
        "message": "User is now an admin",
        "username": user.username,
        "email": user.email
    }