import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from models import User, AllowedEmail, Subject, Lab


SQLITE_URL = "sqlite:///./student_platform.db"

POSTGRES_URL = os.getenv("POSTGRES_URL")

if not POSTGRES_URL:
    print("ERROR: POSTGRES_URL environment variable is not set.")
    sys.exit(1)

if POSTGRES_URL.startswith("postgresql://"):
    POSTGRES_URL = POSTGRES_URL.replace(
        "postgresql://",
        "postgresql+psycopg2://",
        1
    )


sqlite_engine = create_engine(
    SQLITE_URL,
    connect_args={"check_same_thread": False}
)

postgres_engine = create_engine(
    POSTGRES_URL,
    pool_pre_ping=True
)

SQLiteSession = sessionmaker(bind=sqlite_engine)
PostgresSession = sessionmaker(bind=postgres_engine)

sqlite_db = SQLiteSession()
postgres_db = PostgresSession()


try:
    print("Checking destination database...")

    existing_users = postgres_db.query(User).count()
    existing_emails = postgres_db.query(AllowedEmail).count()
    existing_subjects = postgres_db.query(Subject).count()
    existing_labs = postgres_db.query(Lab).count()

    if any([
        existing_users,
        existing_emails,
        existing_subjects,
        existing_labs
    ]):
        print("ERROR: Render PostgreSQL already contains data.")
        print("Migration stopped to prevent duplicates.")
        sys.exit(1)

    print("Destination database is empty.")
    print("Starting migration...\n")

    subjects = sqlite_db.query(Subject).all()

    for subject in subjects:
        postgres_db.add(
            Subject(
                id=subject.id,
                name=subject.name
            )
        )

    postgres_db.flush()

    print(f"Migrated {len(subjects)} subjects")

    allowed_emails = sqlite_db.query(AllowedEmail).all()

    for email in allowed_emails:
        postgres_db.add(
            AllowedEmail(
                id=email.id,
                email=email.email
            )
        )

    postgres_db.flush()

    print(f"Migrated {len(allowed_emails)} allowed emails")

    users = sqlite_db.query(User).all()

    for user in users:
        postgres_db.add(
            User(
                id=user.id,
                username=user.username,
                email=user.email,
                password_hash=user.password_hash,
                is_admin=user.is_admin
            )
        )

    postgres_db.flush()

    print(f"Migrated {len(users)} users")

    labs = sqlite_db.query(Lab).all()

    for lab in labs:
        postgres_db.add(
            Lab(
                id=lab.id,
                subject_id=lab.subject_id,
                title=lab.title,
                description=lab.description,
                filename=lab.filename
            )
        )

    postgres_db.flush()

    print(f"Migrated {len(labs)} labs")

    postgres_db.commit()

    print("\nMigration completed successfully!")

    print("\nResetting PostgreSQL ID sequences...")

    sequence_tables = [
        "users",
        "allowed_emails",
        "subjects",
        "labs"
    ]

    with postgres_engine.begin() as connection:
        for table in sequence_tables:
            connection.execute(
                text(
                    f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table}', 'id'),
                        COALESCE(
                            (SELECT MAX(id) FROM {table}),
                            1
                        ),
                        true
                    )
                    """
                )
            )

    print("Sequences reset successfully.")

except Exception as e:
    postgres_db.rollback()

    print("\nMigration failed.")
    print("Error:")
    print(e)

    sys.exit(1)

finally:
    sqlite_db.close()
    postgres_db.close()