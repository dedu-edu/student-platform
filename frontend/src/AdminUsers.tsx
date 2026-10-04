import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL;

type UserRow = {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
};

type AllowedEmail = {
  id: number;
  email: string;
};

type Props = {
  currentUserId: number;
  section: "users" | "emails";
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

export default function AdminUsers({ currentUserId, section }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const report = (text: string, error = false) => {
    setStatus(text);
    setIsError(error);
  };

  const loadAll = useCallback(async () => {
    try {
      const [userData, emailData] = await Promise.all([
        api<UserRow[]>("/users"),
        api<AllowedEmail[]>("/admin/allowed-emails"),
      ]);
      // keep only the fields we show; never hold password hashes in state
      setUsers(
        userData.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          is_admin: u.is_admin,
        })),
      );
      setEmails(emailData.map((e) => ({ id: e.id, email: e.email })));
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function makeAdmin(user: UserRow) {
    try {
      await api(`/admin/users/${user.id}/make-admin`, { method: "PUT" });
      report(`${user.username} админ боллоо`);
      await loadAll();
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    }
  }

  async function removeAdmin(user: UserRow) {
    if (!window.confirm(`${user.username}-ийн админ эрхийг хасах уу?`)) return;
    try {
      await api(`/admin/users/${user.id}/remove-admin`, { method: "PUT" });
      report(`${user.username}-ийн админ эрх хасагдлаа`);
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
        body: JSON.stringify({ email }),
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
                    {u.is_admin && <span className="badge">админ</span>}
                    <small>{u.email}</small>
                  </span>
                  <span className="row-actions">
                    {u.is_admin ? (
                      <button
                        type="button"
                        onClick={() => removeAdmin(u)}
                        disabled={u.id === currentUserId}
                        title={
                          u.id === currentUserId
                            ? "Өөрийнхөө админ эрхийг хасах боломжгүй"
                            : undefined
                        }
                      >
                        Админ эрх хасах
                      </button>
                    ) : (
                      <button type="button" onClick={() => makeAdmin(u)}>
                        Админ болгох
                      </button>
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
              <button type="submit">И-мэйл нэмэх</button>
            </form>

            {!loading && emails.length === 0 ? (
              <p>Жагсаалт хоосон байна</p>
            ) : (
              <ul className="admin-list">
                {emails.map((item) => (
                  <li key={item.id}>
                    <span className="admin-list-main">{item.email}</span>
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