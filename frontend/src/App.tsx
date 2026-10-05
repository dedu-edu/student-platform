import { useEffect, useState } from "react"
import "./App.css"
import Register from "./Register";
import AdminUsers from "./AdminUsers";
const API_URL = import.meta.env.VITE_API_URL;

type User = {
  id: number
  username: string
  email: string
  is_admin: boolean
}

type AdminTab = "subjects" | "labs" | "users" | "emails"

const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: "subjects", label: "Хичээлүүд" },
  { id: "labs", label: "Лабууд" },
  { id: "users", label: "Хэрэглэгчид" },
  { id: "emails", label: "И-мэйлүүд" },
]

type Subject = {
  id: number
  name: string
}

type Lab = {
  id: number
  subject_id: number
  title: string
  description: string | null
  filename: string | null
}

function App() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")

  const [user, setUser] = useState<User | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null)
  const [labs, setLabs] = useState<Lab[]>([])
  const [selectedLab, setSelectedLab] = useState<Lab | null>(null)

  const [newSubjectName, setNewSubjectName] = useState("")

  const [newLabTitle, setNewLabTitle] = useState("")
  const [newLabDescription, setNewLabDescription] = useState("")
  const [newLabSubjectId, setNewLabSubjectId] = useState("")
  const [labFile, setLabFile] = useState<File | null>(null)

  const [adminLabs, setAdminLabs] = useState<Lab[]>([])

  const [editingLab, setEditingLab] = useState<Lab | null>(null)
  const [editLabTitle, setEditLabTitle] = useState("")
  const [editLabDescription, setEditLabDescription] = useState("")
  const [editLabSubjectId, setEditLabSubjectId] = useState("")
  const [editLabFile, setEditLabFile] = useState<File | null>(null)
  const [showRegister, setShowRegister] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("subjects")
  const [labFilter, setLabFilter] = useState("")
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null)
  const [editSubjectName, setEditSubjectName] = useState("")

  // The Labs tab needs every lab from every subject, so load them when it opens
  // (and again whenever the subjects list is refreshed after an add/edit).
  useEffect(() => {
    if (user?.is_admin && adminTab === "labs") {
      void loadAllAdminLabs(subjects)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, adminTab, subjects])

  const handleRegister = async (
    username: string,
    email: string,
    password: string
  ) => {
    const response = await fetch(`${API_URL}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        email,
        password,
      }),
    });
  
    const data = await response.json();
  
    if (!response.ok) {
      throw new Error(data.detail || "Бүртгүүлэх боломжгүй");
    }
  
    alert("Амжилттай бүртгүүллээ!!");
  
    setShowRegister(false);
  };

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setMessage("")
  
    if (!username.trim() && !password.trim()) {
      setMessage("Хэрэглэгчийн нэр болон нууц үгээ оруулна уу!")
      return
    }
  
    if (!username.trim()) {
      setMessage("Хэрэглэгчийн нэрээ оруулна уу!")
      return
    }
  
    if (!password) {
      setMessage("Нууц үгээ оруулна уу!")
      return
    }
  
    const formData = new URLSearchParams()
  
    formData.append("username", username)
    formData.append("password", password)
  
    try {
      const response = await fetch(
        `${API_URL}/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: formData
        }
      )
  
      const data = await response.json()
  
      if (!response.ok) {
        setMessage(data.detail || "Нэвтэрч чадсангүй.")
        return
      }
  
      localStorage.setItem("token", data.access_token)
  
      const meResponse = await fetch(
        `${API_URL}/me`,
        {
          headers: {
            Authorization: `Bearer ${data.access_token}`
          }
        }
      )
  
      const meData = await meResponse.json()
  
      if (!meResponse.ok) {
        setMessage("Хэрэглэгчийн мэдээлэл олдсонгүй")
        return
      }
  
      setUser(meData)
  
      await loadSubjects(data.access_token)
  
    } catch (error) {
      setMessage("Сервертэй холбогдож чадсангүй")
      console.error(error)
    }
  }

  async function loadSubjects(token: string) {
    const response = await fetch(
      `${API_URL}/subjects`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Хичээлүүдийг загсааж чадсангүй.")
      return
    }

    setSubjects(data)
  }

  async function openSubject(subject: Subject) {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    const response = await fetch(
      `${API_URL}/subjects/${subject.id}/labs`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Лабуудыг загсааж чадсангүй")
      return
    }

    setSelectedSubject(subject)
    setLabs(data)
    setSelectedLab(null)
  }

  async function openLab(lab: Lab) {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    const response = await fetch(
      `${API_URL}/labs/${lab.id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Лабуудыг загсааж чадсангүй")
      return
    }

    setSelectedLab(data)
  }

  async function downloadLab() {
    const token = localStorage.getItem("token")

    if (!token || !selectedLab) {
      return
    }

    try {
      const response = await fetch(
        `${API_URL}/labs/${selectedLab.id}/download`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (!response.ok) {
        const data = await response.json()
        setMessage(data.detail || "Суулгаж чадсангүй")
        return
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)

      const link = document.createElement("a")

      link.href = downloadUrl
      link.download = selectedLab.filename
        ? selectedLab.filename.split("_").slice(1).join("_")
        : "download"

      document.body.appendChild(link)
      link.click()

      link.remove()
      window.URL.revokeObjectURL(downloadUrl)

    } catch (error) {
      setMessage("Суулгаж чадсангүй")
      console.error(error)
    }
  }

  async function createSubject(event: React.FormEvent) {
    event.preventDefault()

    const token = localStorage.getItem("token")

    if (!token || !newSubjectName.trim()) {
      return
    }

    const response = await fetch(
      `${API_URL}/admin/subjects`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newSubjectName
        })
      }
    )
    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Хичээл үүсгэж чадсангүй.")
      return
    }

    setMessage("Шинэ хичээл үүсгэлээ!")
    setNewSubjectName("")

    await loadSubjects(token)
  }

  async function updateSubject(event: React.FormEvent) {
    event.preventDefault()
  
    const token = localStorage.getItem("token")
  
    if (!token || !editingSubject) {
      return
    }
  
    if (!editSubjectName.trim()) {
      setMessage("Хичээлийн нэр хоосон байж болохгүй.")
      return
    }
  
    const response = await fetch(
      `${API_URL}/admin/subjects/${editingSubject.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editSubjectName.trim()
        })
      }
    )
  
    const data = await response.json()
  
    if (!response.ok) {
      setMessage(data.detail || "Хичээллийг шинэчилж чадсангүй")
      return
    }
  
    setMessage("Амжилттай шинэчиллээ!")
  
    setEditingSubject(null)
    setEditSubjectName("")
  
    await loadSubjects(token)
  }

  async function deleteSubject(subject: Subject) {
    const token = localStorage.getItem("token")
  
    if (!token) {
      return
    }
  
    const confirmed = window.confirm(
      `Устгах "${subject.name}"?\n\n Мөн энэ хичээлтэй холбоотой бүх file-уудыг устгах болно. Итгэлтэй байна уу? .`
    )
  
    if (!confirmed) {
      return
    }
  
    const response = await fetch(
      `${API_URL}/admin/subjects/${subject.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )
  
    const data = await response.json()
  
    if (!response.ok) {
      setMessage(data.detail || "Устгаж чадсангүй.")
      return
    }
  
    setMessage("Амжилттай устгагдлаа!")
  
    if (
      selectedSubject &&
      selectedSubject.id === subject.id
    ) {
      setSelectedSubject(null)
      setLabs([])
      setSelectedLab(null)
    }
  
    await loadSubjects(token)
  }

  async function createLab(event: React.FormEvent) {
    event.preventDefault()

    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    if (!newLabSubjectId || !newLabTitle.trim()) {
      setMessage("Хичээлийн нэр оруулна уу!")
      return
    }

    const response = await fetch(
      `${API_URL}/admin/labs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          subject_id: Number(newLabSubjectId),
          title: newLabTitle,
          description: newLabDescription
        })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Лаб үүсгэж чадсангүй.")
      return
    }

    if (labFile) {
      await uploadFile(data.id, token)
    } else {
      setMessage("Амжилттай лаб үүсгэж чадлаа!")
    }

    setNewLabTitle("")
    setNewLabDescription("")
    setNewLabSubjectId("")
    setLabFile(null)

    await loadSubjects(token)
  }

  async function uploadFile(labId: number, token: string) {
    if (!labFile) {
      return
    }

    const formData = new FormData()

    formData.append("file", labFile)

    const response = await fetch(
      `${API_URL}/admin/labs/${labId}/upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(
        data.detail || "file байрлуулж чадсангүй."
      )
      return
    }

    setMessage("File байрлуулж чадлаа!")
  }

  async function loadAllAdminLabs(subjectList: Subject[]) {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    try {
      const results = await Promise.all(
        subjectList.map(async (subject) => {
          const response = await fetch(
            `${API_URL}/subjects/${subject.id}/labs`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          )

          if (!response.ok) {
            return [] as Lab[]
          }

          return (await response.json()) as Lab[]
        })
      )

      setAdminLabs(results.flat())
    } catch {
      setMessage("Лабуудыг ачаалж чадсангүй")
    }
  }

  function startEditingLab(lab: Lab) {
    setEditingLab(lab)
    setEditLabTitle(lab.title)
    setEditLabDescription(lab.description || "")
    setEditLabSubjectId(String(lab.subject_id))
    setEditLabFile(null)
    setMessage("")
  }

  async function deleteLab(lab: Lab) {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    const confirmed = window.confirm(
      `Устгах "${lab.title}"?\n\nЭнэ лаб болон түүний file-ыг устгах болно. Итгэлтэй байна уу?`
    )

    if (!confirmed) {
      return
    }

    try {
      const response = await fetch(
        `${API_URL}/admin/labs/${lab.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)

        setMessage(
          response.status === 404 || response.status === 405
            ? "Backend дээр лаб устгах route алга. Backend-ээ шинэчилнэ үү."
            : data?.detail || "Лабыг устгаж чадсангүй."
        )
        return
      }

      setMessage("Лаб амжилттай устгагдлаа!")

      // refreshing subjects also refreshes the Labs tab list
      await loadSubjects(token)
    } catch {
      setMessage("Лабыг устгаж чадсангүй.")
    }
  }

  function cancelEditingLab() {
    setEditingLab(null)
    setEditLabFile(null)
    setMessage("")
  }

  async function updateLab(event: React.FormEvent) {
    event.preventDefault()

    const token = localStorage.getItem("token")

    if (!token || !editingLab) {
      return
    }

    if (!editLabSubjectId || !editLabTitle.trim()) {
      setMessage("Аль нэг хичээллийг сонгоно уу.")
      return
    }

    const response = await fetch(
      `${API_URL}/admin/labs/${editingLab.id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          subject_id: Number(editLabSubjectId),
          title: editLabTitle,
          description: editLabDescription
        })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Лабыг байршуулж чадсангүй.")
      return
    }

    if (editLabFile) {
      const formData = new FormData()

      formData.append("file", editLabFile)

      const fileResponse = await fetch(
        `${API_URL}/admin/labs/${editingLab.id}/file`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData
        }
      )

      if (!fileResponse.ok) {
        setMessage(
          "file-ыг шинэчилж чадсангүй"
        )
        return
      }
    }

    setMessage("Лабыг шинэчиллээ!")

    setEditingLab(null)
    setEditLabFile(null)

    await loadSubjects(token)
  }

  function backToSubjects() {
    setSelectedSubject(null)
    setLabs([])
    setSelectedLab(null)
  }

  function backToLabs() {
    setSelectedLab(null)
  }

  function logout() {
    localStorage.removeItem("token")

    setUser(null)
    setSubjects([])
    setSelectedSubject(null)
    setLabs([])
    setSelectedLab(null)
    setAdminLabs([])
    setEditingLab(null)
  }

  if (!user) {
    if (showRegister) {
      return (
        <Register
          onRegister={handleRegister}
          onBackToLogin={() => setShowRegister(false)}
        />
      );
    }
  
    return (
      <div>
        <h1>The Eden</h1>
  
        <form onSubmit={handleLogin}>
          <div>
            <label>Бүртгүүлсэн нэр</label>
            <br />
            <input
              type="text"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
              required
            />
          </div>
  
          <br />
  
          <div>
            <label>Нууц үг</label>
            <br />
            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
            />
          </div>
  
          <br />
  
          <button type="submit">
            Нэвтрэх
          </button>
        </form>
  
        <p>{message}</p>
  
        <hr />
  
        <button
          type="button"
          onClick={() => setShowRegister(true)}
        >
          Бүртгүүлэх
        </button>
      </div>
    );
  }

  if (user.is_admin) {
    const visibleLabs = labFilter
      ? adminLabs.filter((lab) => String(lab.subject_id) === labFilter)
      : adminLabs

    return (
      <div>
        <header className="topbar">
          <h1>Админ dashboard</h1>

          <div className="topbar-right">
            <span className="topbar-user">
              Тавтай морил, <strong>{user.username}</strong>!
            </span>

            <button onClick={logout}>
              Бүртгэлээс гарах
            </button>
          </div>
        </header>

        <nav className="tabs" role="tablist" aria-label="Админ цэс">
          {ADMIN_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={adminTab === tab.id}
              className={adminTab === tab.id ? "tab active" : "tab"}
              onClick={() => {
                setAdminTab(tab.id)
                setMessage("")
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {adminTab === "subjects" && (
          <section className="win">
            <h2 className="win-title">Хичээлүүд</h2>

            <div className="win-body">
              <form className="inline-form" onSubmit={createSubject}>
                <input
                  type="text"
                  placeholder="Хичээллийн нэр"
                  value={newSubjectName}
                  onChange={(event) =>
                    setNewSubjectName(event.target.value)
                  }
                />

                <button type="submit">
                  хичээлийг нэмэх
                </button>
              </form>

              {subjects.length === 0 ? (
                <p>Хичээл алга.</p>
              ) : (
                <ul className="admin-list">
                  {subjects.map((subject) => (
                    <li key={subject.id}>
                      {editingSubject?.id === subject.id ? (
                        <form
                          className="inline-form"
                          onSubmit={updateSubject}
                        >
                          <input
                            type="text"
                            value={editSubjectName}
                            onChange={(event) =>
                              setEditSubjectName(event.target.value)
                            }
                          />

                          <button type="submit">
                            хадгалах
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubject(null)
                              setEditSubjectName("")
                            }}
                          >
                            Цуцлах
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="admin-list-main">
                            {subject.name}
                          </span>

                          <span className="row-actions">
                            <button
                              onClick={() => {
                                setEditingSubject(subject)
                                setEditSubjectName(subject.name)
                                setMessage("")
                              }}
                            >
                              Шинэчлэх
                            </button>

                            <button
                              onClick={() => deleteSubject(subject)}
                            >
                              Устгах
                            </button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {adminTab === "labs" && (
          <section className="win">
            <h2 className="win-title">
              {editingLab ? "Лабыг шинэчлэх" : "Лабууд"}
            </h2>

            <div className="win-body">
              {editingLab ? (
                <form className="form-grid" onSubmit={updateLab}>
                  <div>
                    <label>Хичээл</label>

                    <select
                      value={editLabSubjectId}
                      onChange={(event) =>
                        setEditLabSubjectId(event.target.value)
                      }
                    >
                      {subjects.map((subject) => (
                        <option
                          key={subject.id}
                          value={subject.id}
                        >
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label>Лабын нэр</label>

                    <input
                      type="text"
                      value={editLabTitle}
                      onChange={(event) =>
                        setEditLabTitle(event.target.value)
                      }
                    />
                  </div>

                  <div className="span-2">
                    <label>Тайлбар</label>

                    <textarea
                      value={editLabDescription}
                      onChange={(event) =>
                        setEditLabDescription(event.target.value)
                      }
                    />
                  </div>

                  <div className="span-2">
                    <label>File-ыг солих</label>

                    <input
                      type="file"
                      onChange={(event) =>
                        setEditLabFile(
                          event.target.files?.[0] || null
                        )
                      }
                    />
                  </div>

                  <div className="span-2">
                    <button type="submit">
                      Хадгалах
                    </button>

                    <button
                      type="button"
                      onClick={cancelEditingLab}
                    >
                      Цуцлах
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <details className="fold">
                    <summary>+ Лаб нэмэх</summary>

                    <form className="form-grid" onSubmit={createLab}>
                      <div>
                        <label>Хичээл</label>

                        <select
                          value={newLabSubjectId}
                          onChange={(event) =>
                            setNewLabSubjectId(event.target.value)
                          }
                        >
                          <option value="">
                            Хичээлийг сонгоно уу
                          </option>

                          {subjects.map((subject) => (
                            <option
                              key={subject.id}
                              value={subject.id}
                            >
                              {subject.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label>Лабын нэр</label>

                        <input
                          type="text"
                          placeholder="Lab 1 - Introduction"
                          value={newLabTitle}
                          onChange={(event) =>
                            setNewLabTitle(event.target.value)
                          }
                        />
                      </div>

                      <div className="span-2">
                        <label>Тайлбар</label>

                        <textarea
                          placeholder="Лабын тайлбар"
                          value={newLabDescription}
                          onChange={(event) =>
                            setNewLabDescription(event.target.value)
                          }
                        />
                      </div>

                      <div className="span-2">
                        <label>Лабын file</label>

                        <input
                          type="file"
                          onChange={(event) =>
                            setLabFile(
                              event.target.files?.[0] || null
                            )
                          }
                        />
                      </div>

                      <div className="span-2">
                        <button type="submit">
                          Лабыг нэмэх
                        </button>
                      </div>
                    </form>
                  </details>

                  <div className="inline-form">
                    <select
                      aria-label="Хичээлээр шүүх"
                      value={labFilter}
                      onChange={(event) =>
                        setLabFilter(event.target.value)
                      }
                    >
                      <option value="">Бүх хичээл</option>

                      {subjects.map((subject) => (
                        <option
                          key={subject.id}
                          value={subject.id}
                        >
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {visibleLabs.length === 0 ? (
                    <p>Лаб алга.</p>
                  ) : (
                    <ul className="admin-list">
                      {visibleLabs.map((lab) => (
                        <li key={lab.id}>
                          <span className="admin-list-main">
                            {lab.title}

                            <span className="badge">
                              {subjects.find(
                                (subject) =>
                                  subject.id === lab.subject_id
                              )?.name ?? "—"}
                            </span>

                            {lab.description && (
                              <small className="block">
                                {lab.description}
                              </small>
                            )}

                            <small className="block">
                              {lab.filename
                                ? `📎 ${lab.filename
                                    .split("_")
                                    .slice(1)
                                    .join("_")}`
                                : "file оруулаагүй"}
                            </small>
                          </span>

                          <span className="row-actions">
                            <button
                              onClick={() => startEditingLab(lab)}
                            >
                              Шинэчлэх
                            </button>

                            <button onClick={() => deleteLab(lab)}>
                              Устгах
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {adminTab === "users" && (
          <AdminUsers section="users" currentUserId={user.id} />
        )}

        {adminTab === "emails" && (
          <AdminUsers section="emails" currentUserId={user.id} />
        )}

        <p>{message}</p>
      </div>
    )
  }

  if (selectedLab) {
    return (
      <div>
        <header className="topbar">
          <h1>The Eden</h1>
        </header>

        <section className="subhead">
          <button onClick={backToLabs}>
            ← Лабууд руу буцах
          </button>
          <h2>{selectedLab.title}</h2>
        </section>

        {selectedLab.description && (
          <p>{selectedLab.description}</p>
        )}

        {selectedLab.filename ? (
          <>
            <p>📎 Бэлэн байгаа file-ууд</p>

            <button onClick={downloadLab}>
              file-ыг суулгах
            </button>
          </>
        ) : (
          <p>Ямарч лаб оруулаагүй байна.</p>
        )}

        <p>{message}</p>
      </div>
    )
  }

  if (selectedSubject) {
    return (
      <div>
        <header className="topbar">
          <h1>The Eden</h1>
        </header>

        <section className="subhead">
          <button onClick={backToSubjects}>
            ← Хичээл руу буцах
          </button>
          <h2>{selectedSubject.name}</h2>
        </section>

        {labs.length === 0 ? (
          <p>Ямарч лаб байхгүй байна.</p>
        ) : (
          <section className="tile-grid">
            {labs.map((lab) => (
              <button
                key={lab.id}
                className="tile"
                onClick={() => openLab(lab)}
              >
                <span className="tile-title">{lab.title}</span>
                {lab.description && (
                  <span className="tile-desc">{lab.description}</span>
                )}
                {lab.filename && (
                  <span className="tile-badge">файлтай</span>
                )}
              </button>
            ))}
          </section>
        )}
      </div>
    )
  }

  return (
    <div>
      <header className="topbar">
        <h1>The Eden</h1>

        <div className="topbar-right">
          <span className="topbar-user">
            Тавтай морил, <strong>{user.username}</strong>!
          </span>

          <button onClick={logout}>
            Бүртгэлээс гарах
          </button>
        </div>
      </header>

      <h2>Хичээлүүд</h2>

      {subjects.length === 0 ? (
        <p>Ямарч хичээл алга.</p>
      ) : (
        <section className="tile-grid">
          {subjects.map((subject) => (
            <button
              key={subject.id}
              className="tile"
              onClick={() => openSubject(subject)}
            >
              <span className="tile-title">{subject.name}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

export default App