"""
Activity log helpers: record an event and turn a User-Agent header into a
short "browser · OS · device" label. No IP addresses are stored.
"""
import re
from datetime import timedelta

from fastapi import Request
from sqlalchemy.orm import Session

import models
from models import utcnow

EVENT_REGISTER = "register"
EVENT_LOGIN = "login"
EVENT_LOGOUT = "logout"
EVENT_DOWNLOAD = "download"
EVENT_SUBMIT = "submit"
EVENT_VIEW = "view"  # opened a file's preview in the page
EVENT_PASSWORD_RESET = "password_reset"  # an admin set a temporary password
EVENT_PASSWORD_CHANGE = "password_change"

# how often last_seen_at is written, so every request is not a database write
LAST_SEEN_EVERY = timedelta(minutes=1)

# order matters: Edge and Opera also say "Chrome", Chrome also says "Safari"
_BROWSERS = [
    ("Edge", r"Edg(e|A|iOS)?/"),
    ("Opera", r"OPR/|Opera"),
    ("Samsung Internet", r"SamsungBrowser/"),
    ("Firefox", r"Firefox/|FxiOS/"),
    ("Chrome", r"Chrome/|CriOS/"),
    ("Safari", r"Safari/"),
]
_SYSTEMS = [
    ("Android", r"Android"),
    ("iOS", r"iPhone|iPad|iPod"),
    ("Windows", r"Windows"),
    ("macOS", r"Macintosh|Mac OS X"),
    ("Linux", r"Linux"),
]


def describe_device(user_agent: str | None) -> str | None:
    if not user_agent:
        return None

    browser = next(
        (name for name, pattern in _BROWSERS if re.search(pattern, user_agent)),
        "Бусад хөтөч"
    )
    system = next(
        (name for name, pattern in _SYSTEMS if re.search(pattern, user_agent)),
        "Бусад"
    )

    if re.search(r"iPad|Tablet", user_agent):
        kind = "Tablet"
    elif re.search(r"Mobi|iPhone|Android", user_agent):
        kind = "Mobile"
    else:
        kind = "Desktop"

    return f"{browser} · {system} · {kind}"


def log_event(
    db: Session,
    user: models.User,
    event: str,
    request: Request | None = None,
    detail: str | None = None,
):
    """Add a log row to the session; the caller commits."""
    user_agent = request.headers.get("user-agent") if request else None

    db.add(models.ActivityLog(
        user_id=user.id,
        school_id=user.school_id,
        event=event,
        detail=detail,
        device=describe_device(user_agent),
        user_agent=(user_agent or "")[:500] or None,
    ))


def touch_last_seen(db: Session, user: models.User):
    now = utcnow()
    last = user.last_seen_at

    if last is not None and last.tzinfo is None:
        # SQLite gives naive datetimes back; they are stored as UTC
        last = last.replace(tzinfo=now.tzinfo)

    if last is None or now - last >= LAST_SEEN_EVERY:
        user.last_seen_at = now
        db.commit()
