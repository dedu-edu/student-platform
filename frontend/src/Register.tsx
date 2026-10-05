import { useState } from "react";
import type { FormEvent } from "react";
interface RegisterProps {
  onRegister: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  onBackToLogin: () => void;
}

export default function Register({
  onRegister,
  onBackToLogin,
}: RegisterProps) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      await onRegister(username, email, password);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Бүртгэл үүсгэх</h1>
        <p>Join The Edenlock</p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Хэрэглэгчийн нэр"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Нууц үг"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Нууц үг дахин бичих"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Бүртгэл үүсгэж байна..." : "Бүртгүүлэх"}
          </button>
        </form>

        <div className="auth-switch">
          Аль хэдийн Account-тай?{" "}
          <button
            type="button"
            onClick={onBackToLogin}
            className="text-button"
          >
            Нэвтрэх
          </button>
        </div>
      </div>
    </div>
  );
}