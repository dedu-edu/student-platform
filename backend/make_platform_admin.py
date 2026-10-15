"""
Make an existing account a platform admin (or take it away).
Platform admin can only be given here, never through the website.

Run from the backend folder, with your virtual environment active:

    python make_platform_admin.py <username>            make platform admin
    python make_platform_admin.py <username> --remove   back to school admin

It uses DATABASE_URL from .env. To change the database on Render, set
DATABASE_URL to Render's External Database URL first (like the migrations).
"""
import sys

from database import SessionLocal
import models
from roles import ROLE_PLATFORM_ADMIN, ROLE_SCHOOL_ADMIN


def main():
    args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    remove = "--remove" in sys.argv

    if len(args) != 1:
        raise SystemExit(__doc__)

    db = SessionLocal()

    try:
        user = db.query(models.User).filter(
            models.User.username == args[0]
        ).first()

        if not user:
            raise SystemExit(f"No user called '{args[0]}'.")

        if remove:
            others = db.query(models.User).filter(
                models.User.role == ROLE_PLATFORM_ADMIN,
                models.User.id != user.id
            ).count()

            if user.role == ROLE_PLATFORM_ADMIN and others == 0:
                raise SystemExit("That is the last platform admin; refusing.")

            user.role = ROLE_SCHOOL_ADMIN
        else:
            user.role = ROLE_PLATFORM_ADMIN

        db.commit()
        print(f"{user.username} is now {user.role}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
