import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

export type LabFile = {
  id: number;
  original_name: string;
  size: number | null;
  created_at: string | null;
  // PDF or image: can be shown in the page
  previewable: boolean;
};

// the media types the backend allows a preview for
const PREVIEW_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? "Алдаа гарлаа");
  }

  return response;
}

// uploads one by one; returns the lab as it is after the last upload
export async function uploadLabFiles<T>(labId: number, files: File[]): Promise<T | null> {
  let lab: T | null = null;

  for (const file of files) {
    const data = new FormData();
    data.append("file", file);
    const response = await request(`/admin/labs/${labId}/upload`, { method: "POST", body: data });
    lab = await response.json();
  }

  return lab;
}

// --------------------------------------- student: download and preview

type Preview = { file: LabFile; url: string; isPdf: boolean };

export function LabFileList({ labId, files }: { labId: number; files: LabFile[] }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");

  // free the previewed file when it changes or the page closes
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function download(file: LabFile) {
    try {
      const response = await request(`/labs/${labId}/files/${file.id}/download`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Суулгаж чадсангүй");
    }
  }

  async function show(file: LabFile) {
    if (preview?.file.id === file.id) {
      setPreview(null);
      return;
    }

    try {
      const response = await request(`/labs/${labId}/files/${file.id}/preview`);
      const type = PREVIEW_TYPES[extension(file.original_name)];
      // the type comes from our own list, never from the file
      const blob = new Blob([await response.arrayBuffer()], { type });
      setPreview({ file, url: URL.createObjectURL(blob), isPdf: type === "application/pdf" });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Нээж чадсангүй");
    }
  }

  if (files.length === 0) {
    return <p>Ямарч file оруулаагүй байна.</p>;
  }

  return (
    <section className="lab-files">
      <ul className="admin-list">
        {files.map((file) => (
          <li key={file.id}>
            <span className="admin-list-main">
              📎 {file.original_name}
              <small>{formatSize(file.size)}</small>
            </span>
            <span className="row-actions">
              {file.previewable && (
                <button type="button" onClick={() => show(file)}>
                  {preview?.file.id === file.id ? "Хаах" : "Үзэх"}
                </button>
              )}
              <button type="button" onClick={() => download(file)}>
                Татах
              </button>
            </span>
          </li>
        ))}
      </ul>

      {preview && (
        <div className="file-preview">
          {preview.isPdf ? (
            <iframe src={preview.url} title={preview.file.original_name} />
          ) : (
            <img src={preview.url} alt={preview.file.original_name} />
          )}
        </div>
      )}

      {error && (
        <p className="auth-error" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

// -------------------------------------- admin: add and remove a lab's files

export function LabFileManager<T extends { id: number; files: LabFile[] }>({
  lab,
  onChange,
}: {
  lab: T;
  onChange: (lab: T) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setBusy(true);

    try {
      const updated = await uploadLabFiles<T>(lab.id, files);
      if (updated) onChange(updated);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "file байрлуулж чадсангүй");
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: LabFile) {
    if (!window.confirm(`"${file.original_name}" file-ыг устгах уу?`)) return;

    try {
      const response = await request(`/admin/labs/${lab.id}/files/${file.id}`, { method: "DELETE" });
      onChange(await response.json());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Устгаж чадсангүй");
    }
  }

  return (
    <div className="lab-file-manager">
      {lab.files.length === 0 ? (
        <small className="block">file оруулаагүй</small>
      ) : (
        <ul className="admin-list">
          {lab.files.map((file) => (
            <li key={file.id}>
              <span className="admin-list-main">
                📎 {file.original_name}
                <small>{formatSize(file.size)}</small>
              </span>
              <span className="row-actions">
                <button type="button" onClick={() => remove(file)}>
                  Устгах
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <input
        type="file"
        multiple
        aria-label="File нэмэх"
        disabled={busy}
        onChange={(event) => {
          void add(event.target.files);
          event.target.value = "";
        }}
      />
      {busy && <small className="block">Байрлуулж байна...</small>}

      {error && (
        <p className="auth-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
