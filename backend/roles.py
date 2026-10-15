ROLE_STUDENT = "student"
ROLE_SCHOOL_ADMIN = "school_admin"
ROLE_PLATFORM_ADMIN = "platform_admin"

# roles a school admin (or the platform admin) may hand out through the API.
# platform_admin is deliberately NOT here: it can only be set in the database.
# teachers do not log in: they are names in the teachers table, not users.
ASSIGNABLE_ROLES = {ROLE_STUDENT, ROLE_SCHOOL_ADMIN}

ADMIN_ROLES = {ROLE_SCHOOL_ADMIN, ROLE_PLATFORM_ADMIN}
