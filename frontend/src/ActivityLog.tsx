import { useCallback, useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

type Summary = {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  last_seen_at: string | null;
  last_device: string | null;
  downloads: number;
};

type Activity = {
  id: number;
  user_id: number;
  username: string | null;
  event: string;
  detail: string | null;
  device: string | null;
  created_at: string;
};

type Props = {
  // only for the platform admin: which school to show
  schoolId: number | null;
};

const EVENT_LABELS: Record<string, string> = {
  register: "Бүртгүүлсэн",
  login: "Нэвтэрсэн",
  logout: "Гарсан",
  download: "Татсан",
  view: "Үзсэн",
  submit: "Даалгавар илгээсэн",
  password_reset: "Нууц үг сэргээсэн (админ)",
  password_change: "Нууц үг сольсон",
};

// local time, e.g. 2026-10-15 22:41
function formatTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// a .csv Excel opens with Cyrillic intact (the BOM tells it the file is UTF-8)
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escape = (cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`;
  const text = "﻿" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function api<T>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "Алдаа гарлаа");
  }
  return response.json() as Promise<T>;
}

export default function ActivityLog({ schoolId }: Props) {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [events, setEvents] = useState<Activity[]>([]);
  const [userFilter, setUserFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (schoolId) params.set("school_id", String(schoolId));
    const schoolOnly = params.toString();
    if (userFilter) params.set("user_id", userFilter);
    if (eventFilter) params.set("event", eventFilter);

    try {
      const [summaryData, eventData] = await Promise.all([
        api<Summary[]>(`/admin/activity/users?${schoolOnly}`),
        api<Activity[]>(`/admin/activity?${params}`),
      ]);
      setSummary(summaryData);
      setEvents(eventData);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Алдаа гарлаа");
    }
  }, [schoolId, userFilter, eventFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="win">
      <h2 className="win-title">Лог</h2>

      <div className="win-body">
        <div className="log-head">
          <h3>Хэрэглэгчид</h3>
          <button
            type="button"
            onClick={() =>
              downloadCsv(`users-${today}.csv`, [
                ["Хэрэглэгч", "И-мэйл", "Бүртгүүлсэн", "Сүүлд нэвтэрсэн", "Сүүлд гарсан", "Сүүлд идэвхтэй", "Төхөөрөмж", "Татсан файл"],
                ...summary.map((u) => [
                  u.username,
                  u.email,
                  formatTime(u.created_at),
                  formatTime(u.last_login_at),
                  formatTime(u.last_logout_at),
                  formatTime(u.last_seen_at),
                  u.last_device ?? "",
                  u.downloads,
                ]),
              ])
            }
          >
            CSV татах
          </button>
        </div>

        <div className="log-scroll">
          <table className="log-table">
            <thead>
              <tr>
                <th>Хэрэглэгч</th>
                <th>Бүртгүүлсэн</th>
                <th>Сүүлд нэвтэрсэн</th>
                <th>Сүүлд гарсан</th>
                <th>Сүүлд идэвхтэй</th>
                <th>Төхөөрөмж</th>
                <th>Татсан</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    <small className="block">{u.email}</small>
                  </td>
                  <td>{formatTime(u.created_at)}</td>
                  <td>{formatTime(u.last_login_at)}</td>
                  <td>{formatTime(u.last_logout_at)}</td>
                  <td>{formatTime(u.last_seen_at)}</td>
                  <td>{u.last_device ?? "—"}</td>
                  <td>{u.downloads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="log-head">
          <h3>Үйлдлүүд</h3>
          <button
            type="button"
            onClick={() =>
              downloadCsv(`activity-${today}.csv`, [
                ["Огноо", "Хэрэглэгч", "Үйлдэл", "Дэлгэрэнгүй", "Төхөөрөмж"],
                ...events.map((e) => [
                  formatTime(e.created_at),
                  e.username ?? "",
                  EVENT_LABELS[e.event] ?? e.event,
                  e.detail ?? "",
                  e.device ?? "",
                ]),
              ])
            }
          >
            CSV татах
          </button>
        </div>

        <div className="inline-form">
          <select
            aria-label="Хэрэглэгчээр шүүх"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          >
            <option value="">Бүх хэрэглэгч</option>
            {summary.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>

          <select
            aria-label="Үйлдлээр шүүх"
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
          >
            <option value="">Бүх үйлдэл</option>
            {Object.entries(EVENT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <button type="button" onClick={() => void load()}>
            Шинэчлэх
          </button>
        </div>

        {events.length === 0 ? (
          <p>Одоохондоо бичлэг алга.</p>
        ) : (
          <div className="log-scroll">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Огноо</th>
                  <th>Хэрэглэгч</th>
                  <th>Үйлдэл</th>
                  <th>Дэлгэрэнгүй</th>
                  <th>Төхөөрөмж</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{formatTime(e.created_at)}</td>
                    <td>{e.username ?? "—"}</td>
                    <td>{EVENT_LABELS[e.event] ?? e.event}</td>
                    <td>{e.detail ?? ""}</td>
                    <td>{e.device ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p className="auth-error" role="status">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
