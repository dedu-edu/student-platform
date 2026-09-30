import { useState } from "react"
import "./App.css"

const API_URL = "http://127.0.0.1:8000"

type User = {
  id: number
  username: string
  email: string
  is_admin: boolean
}

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

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setMessage("")

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
        setMessage(data.detail || "Login failed")
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
        setMessage("Could not get user information")
        return
      }

      setUser(meData)

      await loadSubjects(data.access_token)

    } catch (error) {
      setMessage("Could not connect to server")
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
      setMessage(data.detail || "Could not load subjects")
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
      setMessage(data.detail || "Could not load labs")
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
      setMessage(data.detail || "Could not load lab")
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
        setMessage(data.detail || "Download failed")
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
      setMessage("Could not download file")
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
      setMessage(data.detail || "Could not create subject")
      return
    }

    setMessage("Subject created successfully!")
    setNewSubjectName("")

    await loadSubjects(token)
  }

  async function createLab(event: React.FormEvent) {
    event.preventDefault()

    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    if (!newLabSubjectId || !newLabTitle.trim()) {
      setMessage("Please select a subject and enter a title")
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
      setMessage(data.detail || "Could not create lab")
      return
    }

    if (labFile) {
      await uploadFile(data.id, token)
    } else {
      setMessage("Lab created successfully!")
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
        data.detail || "Lab created, but file upload failed"
      )
      return
    }

    setMessage("Lab and file uploaded successfully!")
  }

  async function loadAdminLabsForSubject(subjectId: number) {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    const response = await fetch(
      `${API_URL}/subjects/${subjectId}/labs`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Could not load labs")
      return
    }

    setAdminLabs(data)
  }

  function startEditingLab(lab: Lab) {
    setEditingLab(lab)
    setEditLabTitle(lab.title)
    setEditLabDescription(lab.description || "")
    setEditLabSubjectId(String(lab.subject_id))
    setEditLabFile(null)
    setMessage("")
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
      setMessage("Please select a subject and enter a title")
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
      setMessage(data.detail || "Could not update lab")
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
          "Lab updated, but file replacement failed"
        )
        return
      }
    }

    setMessage("Lab updated successfully!")

    setEditingLab(null)
    setEditLabFile(null)

    await loadSubjects(token)

    if (editingLab.subject_id) {
      await loadAdminLabsForSubject(
        Number(editLabSubjectId)
      )
    }
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
    return (
      <div>
        <h1>Student Platform</h1>

        <form onSubmit={handleLogin}>
          <div>
            <label>Username</label>
            <br />

            <input
              type="text"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value)
              }
            />
          </div>

          <br />

          <div>
            <label>Password</label>
            <br />

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
            />
          </div>

          <br />

          <button type="submit">
            Login
          </button>
        </form>

        <p>{message}</p>
      </div>
    )
  }

  if (user.is_admin) {
    return (
      <div>
        <h1>Admin Dashboard</h1>

        <p>
          Welcome, <strong>{user.username}</strong>!
        </p>

        <button onClick={logout}>
          Logout
        </button>

        <hr />

        <h2>Add Subject</h2>

        <form onSubmit={createSubject}>
          <input
            type="text"
            placeholder="Subject name"
            value={newSubjectName}
            onChange={(event) =>
              setNewSubjectName(event.target.value)
            }
          />

          <button type="submit">
            Add Subject
          </button>
        </form>

        <hr />

        <h2>Add Lab</h2>

        <form onSubmit={createLab}>
          <div>
            <label>Subject</label>
            <br />

            <select
              value={newLabSubjectId}
              onChange={(event) =>
                setNewLabSubjectId(event.target.value)
              }
            >
              <option value="">
                Select a subject
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

          <br />

          <div>
            <label>Lab Title</label>
            <br />

            <input
              type="text"
              placeholder="Lab 1 - Introduction"
              value={newLabTitle}
              onChange={(event) =>
                setNewLabTitle(event.target.value)
              }
            />
          </div>

          <br />

          <div>
            <label>Description</label>
            <br />

            <textarea
              placeholder="Lab description"
              value={newLabDescription}
              onChange={(event) =>
                setNewLabDescription(event.target.value)
              }
            />
          </div>

          <br />

          <div>
            <label>Lab File</label>
            <br />

            <input
              type="file"
              onChange={(event) =>
                setLabFile(
                  event.target.files?.[0] || null
                )
              }
            />
          </div>

          <br />

          <button type="submit">
            Create Lab
          </button>
        </form>

        <hr />

        <h2>Current Subjects</h2>

        {subjects.length === 0 ? (
          <p>No subjects yet.</p>
        ) : (
          subjects.map((subject) => (
            <div key={subject.id}>
              <p>
                📚 <strong>{subject.name}</strong>
              </p>

              <button
                onClick={() =>
                  loadAdminLabsForSubject(subject.id)
                }
              >
                Show Labs
              </button>

              <hr />
            </div>
          ))
        )}

        {adminLabs.length > 0 && (
          <>
            <h2>Labs</h2>

            {adminLabs.map((lab) => (
              <div key={lab.id}>
                <p>
                  <strong>{lab.title}</strong>
                </p>

                <p>
                  {lab.description}
                </p>

                <p>
                  {lab.filename
                    ? `📎 ${lab.filename
                        .split("_")
                        .slice(1)
                        .join("_")}`
                    : "No file uploaded"}
                </p>

                <button
                  onClick={() =>
                    startEditingLab(lab)
                  }
                >
                  Edit
                </button>

                <hr />
              </div>
            ))}
          </>
        )}

        {editingLab && (
          <>
            <hr />

            <h2>Edit Lab</h2>

            <form onSubmit={updateLab}>
              <div>
                <label>Subject</label>
                <br />

                <select
                  value={editLabSubjectId}
                  onChange={(event) =>
                    setEditLabSubjectId(
                      event.target.value
                    )
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

              <br />

              <div>
                <label>Lab Title</label>
                <br />

                <input
                  type="text"
                  value={editLabTitle}
                  onChange={(event) =>
                    setEditLabTitle(
                      event.target.value
                    )
                  }
                />
              </div>

              <br />

              <div>
                <label>Description</label>
                <br />

                <textarea
                  value={editLabDescription}
                  onChange={(event) =>
                    setEditLabDescription(
                      event.target.value
                    )
                  }
                />
              </div>

              <br />

              <div>
                <label>
                  Replace File
                </label>
                <br />

                <input
                  type="file"
                  onChange={(event) =>
                    setEditLabFile(
                      event.target.files?.[0] || null
                    )
                  }
                />
              </div>

              <br />

              <button type="submit">
                Save Changes
              </button>

              {" "}

              <button
                type="button"
                onClick={cancelEditingLab}
              >
                Cancel
              </button>
            </form>
          </>
        )}

        <p>{message}</p>
      </div>
    )
  }

  if (selectedLab) {
    return (
      <div>
        <h1>Student Platform</h1>

        <button onClick={backToLabs}>
          ← Back to Labs
        </button>

        <h2>{selectedLab.title}</h2>

        <p>
          {selectedLab.description}
        </p>

        {selectedLab.filename ? (
          <>
            <p>📎 File available</p>

            <button onClick={downloadLab}>
              Download File
            </button>
          </>
        ) : (
          <p>No file uploaded yet.</p>
        )}

        <p>{message}</p>
      </div>
    )
  }

  if (selectedSubject) {
    return (
      <div>
        <h1>Student Platform</h1>

        <button onClick={backToSubjects}>
          ← Back to Subjects
        </button>

        <h2>{selectedSubject.name}</h2>

        {labs.length === 0 ? (
          <p>No labs available.</p>
        ) : (
          labs.map((lab) => (
            <div key={lab.id}>
              <button onClick={() => openLab(lab)}>
                {lab.title}
              </button>

              <p>
                {lab.description}
              </p>

              <hr />
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <div>
      <h1>Student Platform</h1>

      <p>
        Welcome, <strong>{user.username}</strong>!
      </p>

      <button onClick={logout}>
        Logout
      </button>

      <hr />

      <h2>Subjects</h2>

      {subjects.length === 0 ? (
        <p>No subjects available.</p>
      ) : (
        subjects.map((subject) => (
          <div key={subject.id}>
            <button
              onClick={() =>
                openSubject(subject)
              }
            >
              {subject.name}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

export default App