"""
Add the activity log to an EXISTING database. Run it after
migrate_to_teachers.py.

Run from the backend folder, with your virtual environment active:

    python migrate_to_activity.py

What it does
  * users get created_at (joined date) and last_seen_at (last active).
    Accounts that already exist have no joined date, because it was never
    recorded; it shows as empty in the Log tab.
  * creates the activity_logs table (logins, logouts, downloads, devices)

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

    db.execute(f"ALTER TABLE users ADD COLUMN created_at {ts}")
    db.execute(f"ALTER TABLE users ADD COLUMN last_seen_at {ts}")

    # the backend may already have made an empty one on start
    if "activity_logs" in db.tables():
        db.execute("DROP TABLE activity_logs")

    db.execute(
        f"CREATE TABLE activity_logs ("
        f"id {pk}, "
        f"user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
        f"school_id INTEGER REFERENCES schools(id), "
        f"event VARCHAR NOT NULL, "
        f"detail VARCHAR, "
        f"device VARCHAR, "
        f"user_agent VARCHAR, "
        f"created_at {ts} NOT NULL)"
    )

    for column in ("user_id", "school_id", "created_at"):
        db.execute(
            f"CREATE INDEX ix_activity_logs_{column} ON activity_logs ({column})"
        )


def main():
    db = Db()

    if "users" not in db.tables():
        raise SystemExit("No existing tables found. On a fresh database, run "
                         "create_platform_admin.py instead.")

    if "teacher_id" not in db.columns("labs"):
        raise SystemExit("Run migrate_to_teachers.py first.")

    if "created_at" in db.columns("users"):
        raise SystemExit("Already migrated (users.created_at exists). Nothing to do.")

    if "activity_logs" in db.tables():
        rows = db.query("SELECT COUNT(*) FROM activity_logs")[0][0]
        if rows:
            raise SystemExit("activity_logs already has data; not touching it.")

    backup = None
    if IS_SQLITE:
        db.conn.close()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{db.path}.before-activity-{stamp}"
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
    print("\nDone. The activity log is ready. Restart the backend.")


if __name__ == "__main__":
    main()
