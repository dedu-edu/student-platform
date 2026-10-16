import os
import bcrypt

from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

from jose import jwt, JWTError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from activity import touch_last_seen
from database import get_db
from models import User
from roles import (
    ROLE_SCHOOL_ADMIN,
    ROLE_PLATFORM_ADMIN,
)

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# all a user with a temporary password may do until they choose a new one
PASSWORD_CHANGE_PATHS = {"/me", "/me/password", "/logout"}

def hash_password(password: str) -> str:
    password_bytes = password.encode("utf-8")
    hashed = bcrypt.hashpw(
        password_bytes,
        bcrypt.gensalt()
    )
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    password_bytes = password.encode("utf-8")
    hash_bytes = password_hash.encode("utf-8")

    return bcrypt.checkpw(
        password_bytes,
        hash_bytes
    )


def create_access_token(data: dict):
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    to_encode.update({
        "exp": expire
    })

    return jwt.encode(
        to_encode,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={
            "WWW-Authenticate": "Bearer"
        }
    )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        username = payload.get("sub")

        if username is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(
        User.username == username
    ).first()

    if user is None:
        raise credentials_exception

    # "last active" in the log; the closest thing to a disconnect time when
    # someone just closes the tab instead of logging out
    touch_last_seen(db, user)

    if user.must_change_password and request.url.path not in PASSWORD_CHANGE_PATHS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required"
        )

    return user

def require_roles(*allowed_roles: str):
    """Dependency factory: only users whose role is in allowed_roles get through."""

    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to do this"
            )

        return current_user

    return dependency


get_current_school_admin = require_roles(
    ROLE_SCHOOL_ADMIN, ROLE_PLATFORM_ADMIN
)
get_current_platform_admin = require_roles(ROLE_PLATFORM_ADMIN)