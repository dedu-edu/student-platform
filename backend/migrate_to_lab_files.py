"""
Let labs have several files, and record when each lab was added (for the
"Шинэ" badge). Run it after migrate_to_submissions.py.

Run from the backend folder, with your virtual environment active:

    python migrate_to_lab_files.py

What it does
  * labs get created_at. Labs that already exist have none, so they never
    show as new.
  * creates the lab_files table and moves each lab's current file into it.
    The files themselves stay where they are in Supabase; nothing is
    uploaded or deleted.

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

    db.execute(f"ALTER TABLE labs ADD COLUMN created_at {ts}")

    # the backend may already have made an empty one on start
    if "lab_files" in db.tables():
        db.execute("DROP TABLE lab_files")

    db.execute(
        f"CREATE TABLE lab_files ("
        f"id {pk}, "
        f"lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE, "
        f"filename VARCHAR NOT NULL, "
        f"original_name VARCHAR NOT NULL, "
        f"size INTEGER, "
        f"created_at {ts})"
    )
    db.execute("CREATE INDEX ix_lab_files_lab_id ON lab_files (lab_id)")

    # stored names look like "<32 hex>_<original name>"
    rows = db.query(
        "SELECT id, filename FROM labs WHERE filename IS NOT NULL "
        "AND filename <> '' ORDER BY id"
    )
    for lab_id, filename in rows:
        original = filename.split("_", 1)[1] if "_" in filename else filename
        db.execute(
            f"INSERT INTO lab_files (lab_id, filename, original_name) "
            f"VALUES ({db.ph}, {db.ph}, {db.ph})",
            (lab_id, filename, original or filename),
        )

    print(f"Moved {len(rows)} lab file(s) into lab_files.")


def main():
    db = Db()

    if "labs" not in db.tables():
        raise SystemExit("No existing tables found. On a fresh database, run "
                         "create_platform_admin.py instead.")

    if "must_change_password" not in db.columns("users"):
        raise SystemExit("Run migrate_to_submissions.py first.")

    if "created_at" in db.columns("labs"):
        raise SystemExit("Already migrated (labs.created_at exists). Nothing to do.")

    if "lab_files" in db.tables():
        rows = db.query("SELECT COUNT(*) FROM lab_files")[0][0]
        if rows:
            raise SystemExit("lab_files already has data; not touching it.")

    backup = None
    if IS_SQLITE:
        db.conn.close()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{db.path}.before-lab-files-{stamp}"
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
    print("\nDone. Labs can now have several files. Restart the backend.")


if __name__ == "__main__":
    main()
