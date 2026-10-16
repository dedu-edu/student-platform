import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL;

const MAX_MB = 10;

// matches the backend's list: ordinary schoolwork only
const ALLOWED = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.rtf,.zip,.rar,.7z,.png,.jpg,.jpeg,.gif,.webp,.py,.ipynb,.c,.cpp,.h,.java,.js,.ts,.html,.css,.sql,.json,.m,.r";

type Submission = {
  id: number;
  lab_id: number;
  original_name: string;
  created_at: string;
  updated_at: string;
};

type SubmissionRow = {
  user_id: number;
  username: string;
  email: string;
  submission: Submission | null;
};

// local time, e.g. 2026-10-15 22:41
function formatTime(value: string) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function request(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });

  if (!response.ok) {
    if (response.status === 405) {
      throw new Error("Backend дээр энэ үйлдэл алга байна. Backend-ээ шинэчилнэ үү.");
    }
    if (response.status === 413) {
      throw new Error(`Файл хэт том байна (${MAX_MB} MB хүртэл)`);
    }
    const body = await response.json().catch(() => null);
    throw new Error(ERRORS[body?.detail] ?? body?.detail ?? "Алдаа гарлаа");
  }

  return response;
}

// the backend answers in English; the ones a student can hit, in Mongolian
const ERRORS: Record<string, string> = {
  "The deadline for this lab has passed": "Илгээх хугацаа дууссан",
  "This lab does not take submissions": "Энэ лаб даалгавар хүлээж авахгүй",
  "This file type is not allowed": "Ийм төрлийн файл илгээх боломжгүй",
  "The file is empty": "Файл хоосон байна",
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------ student: hand in work

export function LabSubmission({
  labId,
  canSubmit,
  open,
  deadline,
}: {
  labId: number;
  canSubmit: boolean;
  // false once the deadline has passed
  open: boolean;
  deadline: string | null;
}) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const report = (text: string, error = false) => {
    setStatus(text);
    setIsError(error);
  };

  useEffect(() => {
    request(`/labs/${labId}/submission`)
      .then((response) => response.json())
      .then(setSubmission)
      .catch((err) => report(err.message, true));
  }, [labId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) return;

    if (file.size > MAX_MB * 1024 * 1024) {
      report(`Файл хэт том байна (${MAX_MB} MB хүртэл)`, true);
      return;
    }

    const data = new FormData();
    data.append("file", file);
    setBusy(true);

    try {
      const response = await request(`/labs/${labId}/submission`, { method: "POST", body: data });
      setSubmission(await response.json());
      setFile(null);
      form.reset();
      report(submission ? "Файлаа шинэчиллээ!" : "Амжилттай илгээлээ!");
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.confirm("Илгээсэн файлаа буцааж авах уу?")) return;

    try {
      await request(`/labs/${labId}/submission`, { method: "DELETE" });
      setSubmission(null);
      report("Илгээлтээ буцааж авлаа");
    } catch (err) {
      report(err instanceof Error ? err.message : "Алдаа гарлаа", true);
    }
  }

  return (
    <section className="win submission">
      <h2 className="win-title">Даалгавар илгээх</h2>

      <div className="win-body">
        {submission ? (
          <p>
            ✅ Илгээсэн: <strong>{submission.original_name}</strong>
            <small className="block">{formatTime(submission.updated_at)}</small>
          </p>
        ) : (
          <p>Одоогоор илгээгээгүй байна.</p>
        )}

        {deadline && (
          <small className="block">
            Эцсийн хугацаа: {formatTime(deadline)}
            {!open && " · хугацаа дууссан"}
          </small>
        )}

        {!open ? (
          <small className="block">Илгээх хугацаа дууссан.</small>
        ) : canSubmit ? (
          <form className="inline-form" onSubmit={submit}>
            <input
              type="file"
              accept={ALLOWED}
              aria-label="Илгээх файл"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button type="submit" disabled={!file || busy}>
              {busy ? "Илгээж байна..." : submission ? "Файл солих" : "Илгээх"}
            </button>
            {submission && (
              <button type="button" onClick={withdraw}>
                Буцааж авах
              </button>
            )}
          </form>
        ) : (
          <small className="block">Сурагчид энд ажлаа илгээнэ.</small>
        )}

        {open && canSubmit && (
          <small className="block">
            {MAX_MB} MB хүртэл: pdf, word, excel, powerpoint, zip, зураг, код.
          </small>
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

// ------------------------------------- admin: who handed in, download

export function LabSubmissions({
  lab,
  onClose,
}: {
  lab: { id: number; title: string };
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await request(`/admin/labs/${lab.id}/submissions`);
      setRows(await response.json());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Алдаа гарлаа");
    } finally {
      setLoading(false);
    }
  }, [lab.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(row: SubmissionRow) {
    if (!row.submission) return;

    try {
      const response = await request(`/admin/submissions/${row.submission.id}/download`);
      saveBlob(await response.blob(), `${row.username}_${row.submission.original_name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Алдаа гарлаа");
    }
  }

  const handedIn = rows.filter((row) => row.submission).length;

  return (
    <section className="win">
      <h2 className="win-title">Илгээлтүүд · {lab.title}</h2>

      <div className="win-body">
        <div className="log-head">
          <button type="button" onClick={onClose}>
            ← Лабууд руу буцах
          </button>
          {!loading && (
            <span className="badge">
              {handedIn} / {rows.length} илгээсэн
            </span>
          )}
          <button type="button" onClick={() => void load()}>
            Шинэчлэх
          </button>
        </div>

        {loading ? (
          <p>Ачаалж байна...</p>
        ) : rows.length === 0 ? (
          <p>Энэ сургуульд сурагч алга.</p>
        ) : (
          <div className="log-scroll">
            <table className="log-table">
              <thead>
                <tr>
                  <th>Сурагч</th>
                  <th>Төлөв</th>
                  <th>Файл</th>
                  <th>Огноо</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      {row.username}
                      <small className="block">{row.email}</small>
                    </td>
                    <td>{row.submission ? "✅ Илгээсэн" : "— Илгээгээгүй"}</td>
                    <td>{row.submission?.original_name ?? ""}</td>
                    <td>{row.submission ? formatTime(row.submission.updated_at) : ""}</td>
                    <td>
                      {row.submission && (
                        <button type="button" onClick={() => download(row)}>
                          Татах
                        </button>
                      )}
                    </td>
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

// ------------------------------- admin: open a lab for hand-ins, deadline

// "2026-10-20T18:00" in local time, as a datetime-local input wants it
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value: string) =>
  value ? new Date(value).toISOString() : null;

export function SubmissionSettings({
  accepts,
  deadline,
  onChange,
}: {
  accepts: boolean;
  deadline: string;
  onChange: (accepts: boolean, deadline: string) => void;
}) {
  return (
    <div className="submission-settings">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={accepts}
          onChange={(event) => onChange(event.target.checked, deadline)}
        />
        Сурагчид даалгавар илгээж болно
      </label>

      {accepts && (
        <label className="deadline">
          Эцсийн хугацаа (заавал биш)
          <input
            type="datetime-local"
            value={deadline}
            onChange={(event) => onChange(accepts, event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
