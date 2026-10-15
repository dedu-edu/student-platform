"""
Migrate an EXISTING database to the schools + roles layout, keeping your data.

Run from the backend folder, with your virtual environment active:

    python migrate_to_schools.py            (asks for the school name)
    python migrate_to_schools.py "My School"

What it does
  * creates the schools table and ONE school that adopts all your current data
  * users:          get that school + a role (old admins -> platform_admin,
                    everyone else -> student); the is_admin column is dropped
  * allowed_emails: get that school + role 'student'
  * subjects:       get that school; teacher (owner) starts empty

Works on SQLite (local) and Postgres (Supabase). Safe to run twice: it stops
if the database is already migrated. SQLite is backed up first and restored
automatically if anything fails. On Postgres everything runs in one
transaction, so a failure changes nothing (back up in Supabase anyway).
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./student_platform.db")
IS_SQLITE = DATABASE_URL.startswith("sqlite")


class Db:
    def __init__(self):
        if IS_SQLITE:
            self.path = DATABASE_URL.replace("sqlite:///", "", 1)
            if not os.path.exists(self.path):
                raise SystemExit(f"Database file not found: {self.path}\n"
                                 "Run this from the backend folder.")
            self.conn = sqlite3.connect(self.path)
            self.ph = "?"
        else:
            import psycopg2  # already in your requirements

            url = DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://", 1)
            self.conn = psycopg2.connect(url)
            self.ph = "%s"

    def execute(self, sql, params=()):
        cur = self.conn.cursor()
        cur.execute(sql, params)
        return cur

    def query(self, sql, params=()):
        return self.execute(sql, params).fetchall()

    def tables(self):
        if IS_SQLITE:
            rows = self.query("SELECT name FROM sqlite_master WHERE type='table'")
        else:
            rows = self.query(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = current_schema()"
            )
        return {r[0] for r in rows}

    def columns(self, table):
        if IS_SQLITE:
            return {r[1] for r in self.query(f"PRAGMA table_info({table})")}
        rows = self.query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = %s",
            (table,),
        )
        return {r[0] for r in rows}


def migrate(db, school_name):
    pk = "INTEGER PRIMARY KEY" if IS_SQLITE else "SERIAL PRIMARY KEY"

    # 1. schools + the one school that adopts the existing data
    db.execute(
        f"CREATE TABLE IF NOT EXISTS schools "
        f"(id {pk}, name VARCHAR NOT NULL UNIQUE)"
    )
    db.execute(
        f"INSERT INTO schools (name) SELECT {db.ph} "
        f"WHERE NOT EXISTS (SELECT 1 FROM schools WHERE name = {db.ph})",
        (school_name, school_name),
    )
    school_id = db.query(
        f"SELECT id FROM schools WHERE name = {db.ph}", (school_name,)
    )[0][0]

    # 2. users
    db.execute("ALTER TABLE users ADD COLUMN school_id INTEGER REFERENCES schools(id)")
    db.execute("ALTER TABLE users ADD COLUMN role VARCHAR NOT NULL DEFAULT 'student'")
    db.execute(f"UPDATE users SET school_id = {school_id}")

    admins = db.query("SELECT username FROM users WHERE is_admin")
    db.execute("UPDATE users SET role = 'platform_admin' WHERE is_admin")
    db.execute("ALTER TABLE users DROP COLUMN is_admin")

    # 3. allowed emails
    db.execute("ALTER TABLE allowed_emails ADD COLUMN school_id INTEGER REFERENCES schools(id)")
    db.execute("ALTER TABLE allowed_emails ADD COLUMN role VARCHAR NOT NULL DEFAULT 'student'")
    db.execute(f"UPDATE allowed_emails SET school_id = {school_id}")

    # 4. subjects
    db.execute("ALTER TABLE subjects ADD COLUMN school_id INTEGER REFERENCES schools(id)")
    db.execute("ALTER TABLE subjects ADD COLUMN teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    db.execute(f"UPDATE subjects SET school_id = {school_id}")
    db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS subjects_school_name_key "
        "ON subjects (school_id, name)"
    )

    if not IS_SQLITE:  # SQLite cannot add NOT NULL afterwards; Postgres can
        db.execute("ALTER TABLE allowed_emails ALTER COLUMN school_id SET NOT NULL")
        db.execute("ALTER TABLE subjects ALTER COLUMN school_id SET NOT NULL")

    return school_id, [a[0] for a in admins]


def main():
    school_name = (
        sys.argv[1].strip() if len(sys.argv) > 1
        else input("Name for the school that adopts your data [The Eden]: ").strip()
    ) or "The Eden"

    db = Db()
    tables = db.tables()

    if "users" not in tables:
        raise SystemExit("No existing tables found. On a fresh database, run "
                         "create_platform_admin.py instead.")

    if "role" in db.columns("users"):
        raise SystemExit("Already migrated (users.role exists). Nothing to do.")

    backup = None
    if IS_SQLITE:
        db.conn.close()
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"{db.path}.before-schools-{stamp}"
        shutil.copy(db.path, backup)
        print(f"Backup written: {backup}")
        db = Db()

    try:
        school_id, admins = migrate(db, school_name)
        db.conn.commit()
    except Exception as error:
        db.conn.rollback()
        db.conn.close()
        if backup:
            shutil.copy(backup, db.path)
            print(f"Failed, original database restored from {backup}")
        raise SystemExit(f"Migration failed: {error}")

    counts = {
        t: db.query(f"SELECT COUNT(*) FROM {t}")[0][0]
        for t in ("users", "allowed_emails", "subjects", "labs")
    }
    db.conn.close()

    print(f"\nDone. School '{school_name}' (id {school_id}) now owns:")
    for table, n in counts.items():
        print(f"  {table}: {n}")
    print(f"Platform admins: {', '.join(admins) or 'none (use create_platform_admin.py)'}")
    print("Everyone else is a student. Restart the backend.")


if __name__ == "__main__":
    main()