"""
Migrate an EXISTING database to school -> subject -> teacher -> labs,
keeping your data. Run it after migrate_to_schools.py.

Run from the backend folder, with your virtual environment active:

    python migrate_to_teachers.py

What it does
  * creates the teachers table (teachers are names, they do not log in)
    and subject_teachers (a subject can have many teachers)
  * labs get a teacher_id (existing labs start without a teacher)
  * if a subject already had a teacher account (subjects.teacher_id), that
    person becomes a teacher name on the subject and gets its labs
  * accounts with the old 'teacher' role become students; the same for
    allowlisted emails
  * Postgres: subjects.teacher_id is dropped. SQLite cannot drop a column that
    has a foreign key, so there it is left in place and simply no longer used.

Works on SQLite (local) and Postgres (Supabase). Safe to run twice: it stops
if the database is already migrated. SQLite is backed up first and restored
automatically if anything fails. On Postgres everything runs in one
transaction, so a failure changes nothing (back up in Supabase anyway).
"""
import shutil
from datetime import datetime

from migrate_to_schools import Db, IS_SQLITE


def migrate(db):
    p = db.ph
    pk = "INTEGER PRIMARY KEY" if IS_SQLITE else "SERIAL PRIMARY KEY"

    db.execute(
        f"CREATE TABLE IF NOT EXISTS teachers ("
        f"id {pk}, "
        f"name VARCHAR NOT NULL, "
        f"school_id INTEGER NOT NULL REFERENCES schools(id), "
        f"CONSTRAINT teachers_school_name_key UNIQUE (school_id, name))"
    )
    # an empty subject_teachers may already exist (the backend creates
    # missing tables on start); rebuild it so it points at teachers
    if "subject_teachers" in db.tables():
        if db.query("SELECT COUNT(*) FROM subject_teachers")[0][0] == 0:
            db.execute("DROP TABLE subject_teachers")

    db.execute(
        "CREATE TABLE IF NOT EXISTS subject_teachers ("
        "subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE, "
        "teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE, "
        "PRIMARY KEY (subject_id, teacher_id))"
    )
    db.execute(
        "ALTER TABLE labs ADD COLUMN teacher_id INTEGER "
        "REFERENCES teachers(id) ON DELETE SET NULL"
    )

    carried = 0

    # subjects.teacher_id pointed at a user account: turn it into a name
    if "teacher_id" in db.columns("subjects"):
        rows = db.query(
            "SELECT s.id, s.school_id, u.username FROM subjects s "
            "JOIN users u ON u.id = s.teacher_id"
        )

        for subject_id, school_id, username in rows:
            found = db.query(
                f"SELECT id FROM teachers WHERE school_id = {p} AND name = {p}",
                (school_id, username),
            )

            if found:
                teacher_id = found[0][0]
            else:
                db.execute(
                    f"INSERT INTO teachers (name, school_id) VALUES ({p}, {p})",
                    (username, school_id),
                )
                teacher_id = db.query(
                    f"SELECT id FROM teachers WHERE school_id = {p} AND name = {p}",
                    (school_id, username),
                )[0][0]

            db.execute(
                f"INSERT INTO subject_teachers (subject_id, teacher_id) "
                f"VALUES ({p}, {p})",
                (subject_id, teacher_id),
            )
            db.execute(
                f"UPDATE labs SET teacher_id = {p} WHERE subject_id = {p}",
                (teacher_id, subject_id),
            )
            carried += 1

        if not IS_SQLITE:
            db.execute("ALTER TABLE subjects DROP COLUMN teacher_id")

    users = db.execute(
        "UPDATE users SET role = 'student' WHERE role = 'teacher'"
    ).rowcount
    emails = db.execute(
        "UPDATE allowed_emails SET role = 'student' WHERE role = 'teacher'"
    ).rowcount

    return carried, users, emails


def main():
    db = Db()
    tables = db.tables()

    if "users" not in tables:
        raise SystemExit("No existing tables found. On a fresh database, run "
                         "create_platform_admin.py instead.")

    if "role" not in db.columns("users"):
        raise SystemExit("Run migrate_to_schools.py first.")

    if "teacher_id" in db.columns("labs"):
        raise SystemExit(
            "Already migrated (labs.teacher_id exists). Nothing to do.\n"
            "If you ran the earlier migrate_to_subject_teachers.py instead, undo it "
            "first:\n"
            "  SQLite:   restore student_platform.db from the "
            "student_platform.db.before-subject-teachers-... backup it made\n"
            "  Postgres: DROP TABLE subject_teachers; "
            "ALTER TABLE labs DROP COLUMN teacher_id;\n"
            "then run this script again."
        )

    backup = None
    if IS_SQLITE:
        db.conn.close()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{db.path}.before-teachers-{stamp}"
        shutil.copy(db.path, backup)
        print(f"Backup written: {backup}")
        db = Db()

    try:
        carried, users, emails = migrate(db)
        db.conn.commit()
    except Exception as error:
        db.conn.rollback()
        db.conn.close()
        if backup:
            shutil.copy(backup, db.path)
            print(f"Failed, original database restored from {backup}")
        raise SystemExit(f"Migration failed: {error}")

    unassigned = db.query("SELECT COUNT(*) FROM labs WHERE teacher_id IS NULL")[0][0]
    db.conn.close()

    print(f"\nDone. Subject teachers carried over: {carried}")
    print(f"Teacher accounts turned into students: {users} (allowlisted emails: {emails})")
    print(f"Labs without a teacher (assign them in the Labs tab): {unassigned}")
    print("Restart the backend.")


if __name__ == "__main__":
    main()
