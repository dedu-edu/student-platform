"""
Add password resets and lab submissions to an EXISTING database. Run it after
migrate_to_activity.py.

Run from the backend folder, with your virtual environment active:

    python migrate_to_submissions.py

What it does
  * users get must_change_password, set when an admin gives someone a
    temporary password. Existing users start with it off.
  * creates the submissions table (students' handed-in lab files)

Works on SQLite (local) and Postgres (Render). Safe to run twice: it stops
if the database is already migrated. SQLite is backed up first and restored
automatically if anything fails. On Postgres everything runs in one
transaction, so a failure changes nothing.
"""
import shutil
from datetime import datetime

from migrate_to_schools import Db, IS_SQLITE


def migrate(db):
    pk = "INTEGER PRIMARY KEY" if IS_SQLITE else "SERIAL PRIMARY KEY"
    ts = "TIMESTAMP" if IS_SQLITE else "TIMESTAMPTZ"
    false = "0" if IS_SQLITE else "FALSE"

    db.execute(
        f"ALTER TABLE users ADD COLUMN must_change_password BOOLEAN "
        f"NOT NULL DEFAULT {false}"
    )

    # the backend may already have made an empty one on start
    if "submissions" in db.tables():
        db.execute("DROP TABLE submissions")

    db.execute(
        f"CREATE TABLE submissions ("
        f"id {pk}, "
        f"lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE, "
        f"user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
        f"filename VARCHAR NOT NULL, "
        f"original_name VARCHAR NOT NULL, "
        f"created_at {ts} NOT NULL, "
        f"updated_at {ts} NOT NULL, "
        f"CONSTRAINT submissions_lab_user_key UNIQUE (lab_id, user_id))"
    )

    for column in ("lab_id", "user_id"):
        db.execute(
            f"CREATE INDEX ix_submissions_{column} ON submissions ({column})"
        )


def main():
    db = Db()

    if "users" not in db.tables():
        raise SystemExit("No existing tables found. On a fresh database, run "
                         "create_platform_admin.py instead.")

    if "created_at" not in db.columns("users"):
        raise SystemExit("Run migrate_to_activity.py first.")

    if "must_change_password" in db.columns("users"):
        raise SystemExit("Already migrated (users.must_change_password exists). "
                         "Nothing to do.")

    if "submissions" in db.tables():
        rows = db.query("SELECT COUNT(*) FROM submissions")[0][0]
        if rows:
            raise SystemExit("submissions already has data; not touching it.")

    backup = None
    if IS_SQLITE:
        db.conn.close()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{db.path}.before-submissions-{stamp}"
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
    print("\nDone. Password resets and submissions are ready. Restart the backend.")


if __name__ == "__main__":
    main()
