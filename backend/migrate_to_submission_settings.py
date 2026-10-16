"""
Per-lab switch for student hand-ins, with an optional deadline. Run it after
migrate_to_lab_files.py.

Run from the backend folder, with your virtual environment active:

    python migrate_to_submission_settings.py

What it does
  * labs get accepts_submissions (off for every existing lab, so students
    can upload only where an admin turns it on) and submission_deadline.

Works on SQLite (local) and Postgres (Render). Safe to run twice: it stops
if the database is already migrated. SQLite is backed up first and restored
automatically if anything fails. On Postgres everything runs in one
transaction, so a failure changes nothing.
"""
import shutil
from datetime import datetime

from migrate_to_schools import Db, IS_SQLITE


def migrate(db):
    ts = "TIMESTAMP" if IS_SQLITE else "TIMESTAMPTZ"
    false = "0" if IS_SQLITE else "FALSE"

    db.execute(
        f"ALTER TABLE labs ADD COLUMN accepts_submissions BOOLEAN "
        f"NOT NULL DEFAULT {false}"
    )
    db.execute(f"ALTER TABLE labs ADD COLUMN submission_deadline {ts}")


def main():
    db = Db()

    if "labs" not in db.tables():
        raise SystemExit("No existing tables found. On a fresh database, run "
                         "create_platform_admin.py instead.")

    if "created_at" not in db.columns("labs"):
        raise SystemExit("Run migrate_to_lab_files.py first.")

    if "accepts_submissions" in db.columns("labs"):
        raise SystemExit("Already migrated (labs.accepts_submissions exists). "
                         "Nothing to do.")

    backup = None
    if IS_SQLITE:
        db.conn.close()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{db.path}.before-submission-settings-{stamp}"
        shutil.copy(db.path, backup)
        print(f"Backup written: {backup}")
        db = Db()

    try:
        migrate(db)
        db.conn.commit()
    except Exception as error:
        db.conn.rollback()
        db.conn.close()
        if backup:
            shutil.copy(backup, db.path)
            print(f"Failed, original database restored from {backup}")
        raise SystemExit(f"Migration failed: {error}")

    db.conn.close()
    print("\nDone. Hand-ins are now off on every lab until you turn them on. "
          "Restart the backend.")


if __name__ == "__main__":
    main()
