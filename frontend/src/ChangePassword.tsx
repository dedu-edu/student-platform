import { useState } from "react";
import type { FormEvent } from "react";

const API_URL = import.meta.env.VITE_API_URL;

const MIN_LENGTH = 8;

// the backend answers in English; show the ones a user can hit in Mongolian
const ERRORS: Record<string, string> = {
  "Current password is incorrect": "Одоогийн нууц үг буруу байна",
  "New password must be different": "Шинэ нууц үг хуучнаасаа өөр байх ёстой",
};

type Props = {
  // true after an admin reset the password: the user has to pick a new one
  forced: boolean;
  onDone: () => void;
  // forced: log out instead; otherwise go back
  onCancel: () => void;
};

export default function ChangePassword({ forced, onDone, onCancel }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (next.length < MIN_LENGTH) {
      setError(`Шинэ нууц үг дор хаяж ${MIN_LENGTH} тэмдэгттэй байна`);
      return;
    }

    if (next !== confirm) {
      setError("Шинэ нууц үгнүүд таарахгүй байна");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/me/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(ERRORS[body?.detail] ?? body?.detail ?? "Алдаа гарлаа");
        return;
      }

      alert("Нууц үг амжилттай солигдлоо!");
      onDone();
    } catch {
      setError("Сервертэй холбогдож чадсангүй");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Нууц үг солих</h1>
        <p>
          {forced
            ? "Админ таны нууц үгийг түр нууц үгээр сольсон. Үргэлжлүүлэхийн өмнө өөрийн шинэ нууц үгээ сонгоно уу."
            : "Одоогийн нууц үгээ оруулаад шинийг сонгоно уу."}
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder={forced ? "Түр нууц үг" : "Одоогийн нууц үг"}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />

          <input
            type="password"
            placeholder={`Шинэ нууц үг (${MIN_LENGTH}+ тэмдэгт)`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />

          <input
            type="password"
            placeholder="Шинэ нууц үг дахин бичих"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? "Хадгалж байна..." : "Нууц үг солих"}
          </button>
        </form>

        <div className="auth-switch">
          <button type="button" onClick={onCancel} className="text-button">
            {forced ? "Бүртгэлээс гарах" : "← Буцах"}
          </button>
        </div>
      </div>
    </div>
  );
}
