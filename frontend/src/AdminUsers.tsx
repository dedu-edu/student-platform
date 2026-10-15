import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL;

type Role = "student" | "school_admin" | "platform_admin";

// platform_admin can only be set in the database, so it is not offered here.
// teachers do not log in: they are added in the "Багш нар" tab instead.
const ROLE_OPTIONS: { id: Role; label: string }[] = [
  { id: "student", label: "Сурагч" },
  { id: "school_admin", label: "Сургуулийн админ" },
];

const ROLE_LABELS: Record<Role, string> = {
  student: "Сурагч",
  school_admin: "Сургуулийн админ",
  platform_admin: "Платформын админ",
};

type UserRow = {
  id: number;
  username: string;
  email: string;
  role: Role;
};

type AllowedEmail = {
  id: number;
  email: string;
  role: Role;
};

type Props = {
  currentUserId: number;
  section: "users" | "emails";
  // only for the platform admin: which school to show, and all schools
  // so a user can be moved to another one
  schoolId: number | null;
  schools: { id: number; name: string }[];
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error("Backend дээр энэ үйлдэл алга байна. Backend-ээ шинэчилнэ үү.");
    }
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "Алдаа гарлаа");
  }

  return response.json() as Promise<T>;
}

export default function AdminUsers({
  currentUserId,
  section,
  schoolId,
  schools,
}: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newEmailRole, setNewEmailRole] = useState<Role>("student");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const report = (text: string, error = false) => {
    setStatus(text);
    setIsError(error);
  };

  const loadAll = useCallback(async () => {
    const query = schoolId ? `?school_id=${schoolId}` : "";
    try {
      const [userData, emailData] = await Promise.all([
        api<UserRow[]>(`/users${query}`),
        api<AllowedEmail[]>(`/admin/allowed-emails${query}`),
      ]);
      // keep only the fields we show; never hold password hashes in state
      setUsers(
        userData.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          role: u.role,
        })),
      );
      setEmails(
        emailData.map((e) => ({ id: e.id, email: e.email, role: e.role })),
      );
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function changeRole(user: UserRow, role: Role) {
    if (
      role === "student" &&
      !window.confirm(`${user.username}-ийн админ эрхийг хасах уу?`)
    ) {
      return;
    }
    try {
      await api(`/admin/users/${user.id}/role`, {
        method: "PUT",
        body: JSON.stringify({ role }),
      });
      report(`${user.username}: ${ROLE_LABELS[role]}`);
      await loadAll();
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    }
  }

  async function moveSchool(user: UserRow, newSchoolId: number) {
    const school = schools.find((s) => s.id === newSchoolId);
    if (
      !school ||
      !window.confirm(`${user.username}-ийг "${school.name}" сургууль руу шилжүүлэх үү?`)
    ) {
      return;
    }
    try {
      await api(`/platform/users/${user.id}/school`, {
        method: "PUT",
        body: JSON.stringify({ school_id: newSchoolId }),
      });
      report(`${user.username} → ${school.name}`);
      await loadAll();
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    }
  }

  async function addEmail(event: FormEvent) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await api("/admin/allowed-emails", {
        method: "POST",
        body: JSON.stringify({ email, role: newEmailRole, school_id: schoolId }),
      });
      setNewEmail("");
      report(`${email} жагсаалтад нэмэгдлээ`);
      await loadAll();
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    }
  }

  async function deleteEmail(item: AllowedEmail) {
    if (!window.confirm(`${item.email}-ийг жагсаалтаас устгах уу?`)) return;
    try {
      await api(`/admin/allowed-emails/${item.id}`, { method: "DELETE" });
      report(`${item.email} жагсаалтаас устгагдлаа`);
      await loadAll();
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    }
  }

  return (
    <section className="win">
      <h2 className="win-title">
        {section === "users" ? "Хэрэглэгчид" : "Зөвшөөрөгдсөн и-мэйлүүд"}
      </h2>

      <div className="win-body">
        {section === "users" &&
          (loading ? (
            <p>Ачаалж байна...</p>
          ) : users.length === 0 ? (
            <p>Хэрэглэгч алга байна</p>
          ) : (
            <ul className="admin-list">
              {users.map((u) => (
                <li key={u.id}>
                  <span className="admin-list-main">
                    {u.username}
                    <small>{u.email}</small>
                  </span>
                  <span className="row-actions">
                    {schools.length > 1 && schoolId && (
                      <select
                        aria-label={`${u.username}-ийн сургууль`}
                        value={schoolId}
                        onChange={(event) =>
                          moveSchool(u, Number(event.target.value))
                        }
                      >
                        {schools.map((school) => (
                          <option key={school.id} value={school.id}>
                            {school.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {u.role === "platform_admin" || u.id === currentUserId ? (
                      <span className="badge">{ROLE_LABELS[u.role]}</span>
                    ) : (
                      <select
                        aria-label={`${u.username}-ийн эрх`}
                        value={u.role}
                        onChange={(event) =>
                          changeRole(u, event.target.value as Role)
                        }
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {section === "emails" && (
          <>
            <form className="inline-form" onSubmit={addEmail}>
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="student@example.com"
                required
              />
              <select
                aria-label="Эрх"
                value={newEmailRole}
                onChange={(event) => setNewEmailRole(event.target.value as Role)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button type="submit">И-мэйл нэмэх</button>
            </form>

            {!loading && emails.length === 0 ? (
              <p>Жагсаалт хоосон байна</p>
            ) : (
              <ul className="admin-list">
                {emails.map((item) => (
                  <li key={item.id}>
                    <span className="admin-list-main">
                      {item.email}
                      <span className="badge">{ROLE_LABELS[item.role]}</span>
                    </span>
                    <span className="row-actions">
                      <button type="button" onClick={() => deleteEmail(item)}>
                        Устгах
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {status && (
          <p className={isError ? "auth-error" : "admin-status"} role="status">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}