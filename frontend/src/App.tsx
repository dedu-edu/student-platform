import { useEffect, useState } from "react"
import "./App.css"
import Register from "./Register";
import AdminUsers from "./AdminUsers";
import ActivityLog from "./ActivityLog";
import ChangePassword from "./ChangePassword";
import {
  LabSubmission,
  LabSubmissions,
  SubmissionSettings,
  toLocalInput,
  fromLocalInput,
} from "./Submissions";
import { LabFileList, LabFileManager, uploadLabFiles } from "./LabFiles";
import type { LabFile } from "./LabFiles";
const API_URL = import.meta.env.VITE_API_URL;

type Role = "student" | "school_admin" | "platform_admin"

type User = {
  id: number
  username: string
  email: string
  role: Role
  school_id: number | null
  school_name: string | null
  is_admin: boolean
  // an admin gave this user a temporary password
  must_change_password: boolean
}

type AdminTab = "schools" | "teachers" | "subjects" | "labs" | "users" | "emails" | "log"

const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: "schools", label: "Сургуулиуд" },
  { id: "teachers", label: "Багш нар" },
  { id: "subjects", label: "Хичээлүүд" },
  { id: "labs", label: "Лабууд" },
  { id: "users", label: "Хэрэглэгчид" },
  { id: "emails", label: "И-мэйлүүд" },
  { id: "log", label: "Лог" },
]

// which tabs each admin role gets; students never see the dashboard
function tabsFor(role: Role): AdminTab[] {
  if (role === "platform_admin") return ["schools", "teachers", "subjects", "labs", "users", "emails", "log"]
  if (role === "school_admin") return ["teachers", "subjects", "labs", "users", "emails", "log"]
  return []
}

const isAdmin = (user: User) =>
  user.role === "school_admin" || user.role === "platform_admin"

// teachers are names on a subject; they do not log in
type Teacher = {
  id: number
  name: string
}

type School = {
  id: number
  name: string
}

type Subject = {
  id: number
  name: string
  school_id: number
  teachers: Teacher[]
}

type Lab = {
  id: number
  subject_id: number
  title: string
  description: string | null
  teacher_id: number | null
  teacher_name: string | null
  created_at: string | null
  files: LabFile[]
  // hand-ins: turned on by an admin, optionally until a deadline
  accepts_submissions: boolean
  submission_deadline: string | null
  submissions_open: boolean
}

// "Шинэ": the lab, or one of its files, was added in the last week
const NEW_FOR_DAYS = 7

function isNew(lab: Lab) {
  const since = Date.now() - NEW_FOR_DAYS * 24 * 60 * 60 * 1000
  return [lab.created_at, ...lab.files.map((file) => file.created_at)].some(
    (time) => time !== null && new Date(time).getTime() >= since
  )
}

const countNew = (labs: Lab[]) => labs.filter(isNew).length

const fileNames = (lab: Lab) =>
  lab.files.map((file) => file.original_name).join(", ")

function TeacherPicker({
  teachers,
  selected,
  onChange,
}: {
  teachers: Teacher[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  if (teachers.length === 0) {
    return <small>Энэ сургуульд багш алга. "Багш нар" цэснээс багш нэмнэ үү.</small>
  }

  return (
    <span className="teacher-picker">
      {teachers.map((teacher) => (
        <label key={teacher.id}>
          <input
            type="checkbox"
            checked={selected.includes(teacher.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, teacher.id]
                  : selected.filter((id) => id !== teacher.id)
              )
            }
          />
          {teacher.name}
        </label>
      ))}
    </span>
  )
}

const teacherNames = (subject: Subject) =>
  subject.teachers.map((teacher) => teacher.name).join(", ")

type TeacherGroup = {
  key: string
  name: string
  labs: Lab[]
}

// school -> subject -> teacher -> labs: a student picks a teacher inside the
// subject. Teachers on the subject show even before they have labs; labs
// without a teacher go under "Бусад".
function teacherGroups(subject: Subject, labs: Lab[]): TeacherGroup[] {
  const groups = new Map<string, TeacherGroup>()

  for (const teacher of subject.teachers) {
    groups.set(String(teacher.id), { key: String(teacher.id), name: teacher.name, labs: [] })
  }

  for (const lab of labs) {
    const key = lab.teacher_id ? String(lab.teacher_id) : "none"

    if (!groups.has(key)) {
      groups.set(key, { key, name: lab.teacher_name ?? "Бусад", labs: [] })
    }

    groups.get(key)!.labs.push(lab)
  }

  return [...groups.values()].sort((a, b) =>
    a.key === "none" ? 1 : b.key === "none" ? -1 : a.name.localeCompare(b.name)
  )
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
  const [labFiles, setLabFiles] = useState<File[]>([])

  const [adminLabs, setAdminLabs] = useState<Lab[]>([])

  const [editingLab, setEditingLab] = useState<Lab | null>(null)
  const [editLabTitle, setEditLabTitle] = useState("")
  const [editLabDescription, setEditLabDescription] = useState("")
  const [editLabSubjectId, setEditLabSubjectId] = useState("")
  const [showRegister, setShowRegister] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("subjects")
  const [labFilter, setLabFilter] = useState("")
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null)
  const [editSubjectName, setEditSubjectName] = useState("")

  // school -> subject -> teacher -> labs
  const [schools, setSchools] = useState<School[]>([])
  const [schoolId, setSchoolId] = useState<number | null>(null)
  const [newSchoolName, setNewSchoolName] = useState("")
  const [editingSchool, setEditingSchool] = useState<School | null>(null)
  const [editSchoolName, setEditSchoolName] = useState("")
  const [schoolTeachers, setSchoolTeachers] = useState<Teacher[]>([])
  const [newSubjectTeacherIds, setNewSubjectTeacherIds] = useState<number[]>([])
  const [editSubjectTeacherIds, setEditSubjectTeacherIds] = useState<number[]>([])
  const [newLabTeacherId, setNewLabTeacherId] = useState("")
  const [editLabTeacherId, setEditLabTeacherId] = useState("")
  const [newLabAccepts, setNewLabAccepts] = useState(false)
  const [newLabDeadline, setNewLabDeadline] = useState("")
  const [editLabAccepts, setEditLabAccepts] = useState(false)
  const [editLabDeadline, setEditLabDeadline] = useState("")
  const [newTeacherName, setNewTeacherName] = useState("")
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null)
  const [editTeacherName, setEditTeacherName] = useState("")
  const [selectedTeacherKey, setSelectedTeacherKey] = useState<string | null>(null)
  // an admin can preview the student side without switching accounts
  const [viewAsStudent, setViewAsStudent] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  // the lab whose hand-ins the admin is looking at
  const [submissionsLab, setSubmissionsLab] = useState<Lab | null>(null)
  // every lab the student can see: search and the "Шинэ" badges
  const [allLabs, setAllLabs] = useState<Lab[]>([])
  const [search, setSearch] = useState("")

  // Reload whenever someone logs in or the platform admin switches school.
  useEffect(() => {
    const token = localStorage.getItem("token")

    // nothing else loads until a temporary password has been replaced
    if (!user || !token || user.must_change_password) {
      return
    }

    void loadSubjects(token)
    void loadAllLabs(token)

    if (isAdmin(user)) {
      void loadSchoolTeachers(token)
    }

    if (user.role === "platform_admin") {
      void loadSchools(token)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, schoolId])

  // The Labs tab needs every lab the user may manage, so load them when it opens
  // (and again whenever the subjects list is refreshed after an add/edit).
  useEffect(() => {
    if (user && isAdmin(user) && !user.must_change_password && adminTab === "labs") {
      void loadAllAdminLabs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, adminTab, subjects])

  // platform admins look at one school at a time
  function schoolQuery() {
    return user?.role === "platform_admin" && schoolId
      ? `?school_id=${schoolId}`
      : ""
  }

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
  
      setSchoolId(meData.school_id)
      setAdminTab(tabsFor(meData.role)[0] ?? "subjects")
      setUser(meData)
  
    } catch (error) {
      setMessage("Сервертэй холбогдож чадсангүй")
      console.error(error)
    }
  }

  async function loadSubjects(token: string) {
    // admins get the selected school's subjects; students their own school's
    const path = user && isAdmin(user)
      ? `/admin/subjects${schoolQuery()}`
      : "/subjects"

    const response = await fetch(
      `${API_URL}${path}`,
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

  async function loadAllLabs(token: string) {
    const response = await fetch(
      `${API_URL}/labs${schoolQuery()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (response.ok) {
      setAllLabs(await response.json())
    }
  }

  async function loadSchoolTeachers(token: string) {
    const response = await fetch(
      `${API_URL}/admin/teachers${schoolQuery()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (response.ok) {
      setSchoolTeachers(await response.json())
    }
  }

  async function saveTeacher(event: React.FormEvent) {
    event.preventDefault()

    const token = localStorage.getItem("token")
    const name = (editingTeacher ? editTeacherName : newTeacherName).trim()

    if (!token || !name) {
      return
    }

    const response = await fetch(
      editingTeacher
        ? `${API_URL}/admin/teachers/${editingTeacher.id}`
        : `${API_URL}/admin/teachers`,
      {
        method: editingTeacher ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, school_id: schoolId })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Багшийг хадгалж чадсангүй.")
      return
    }

    setMessage(editingTeacher ? "Багшийг шинэчиллээ!" : "Шинэ багш нэмлээ!")
    setNewTeacherName("")
    setEditingTeacher(null)
    setEditTeacherName("")

    await loadSchoolTeachers(token)
    // subjects carry their teachers' names
    await loadSubjects(token)
  }

  async function deleteTeacher(teacher: Teacher) {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    const confirmed = window.confirm(
      `Устгах "${teacher.name}"?\n\nТүүний лабууд устахгүй, "Бусад" хэсэгт үлдэнэ.`
    )

    if (!confirmed) {
      return
    }

    const response = await fetch(
      `${API_URL}/admin/teachers/${teacher.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setMessage(data?.detail || "Багшийг устгаж чадсангүй.")
      return
    }

    setMessage("Багш устгагдлаа!")

    await loadSchoolTeachers(token)
    await loadSubjects(token)
  }

  async function loadSchools(token: string) {
    const response = await fetch(
      `${API_URL}/platform/schools`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    )

    if (response.ok) {
      setSchools(await response.json())
    }
  }

  async function saveSchool(event: React.FormEvent) {
    event.preventDefault()

    const token = localStorage.getItem("token")
    const name = (editingSchool ? editSchoolName : newSchoolName).trim()

    if (!token || !name) {
      return
    }

    const response = await fetch(
      editingSchool
        ? `${API_URL}/platform/schools/${editingSchool.id}`
        : `${API_URL}/platform/schools`,
      {
        method: editingSchool ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Сургуулийг хадгалж чадсангүй.")
      return
    }

    setMessage(editingSchool ? "Сургуулийг шинэчиллээ!" : "Шинэ сургууль нэмлээ!")
    setNewSchoolName("")
    setEditingSchool(null)
    setEditSchoolName("")

    await loadSchools(token)
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

    // nothing to choose when the subject has one teacher (or none)
    const groups = teacherGroups(subject, data)
    setSelectedTeacherKey(groups.length === 1 ? groups[0].key : null)
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
          name: newSubjectName,
          school_id: schoolId,
          teacher_ids: newSubjectTeacherIds
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
    setNewSubjectTeacherIds([])

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
          name: editSubjectName.trim(),
          teacher_ids: editSubjectTeacherIds
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

  async function createLab(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const form = event.currentTarget

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
          description: newLabDescription,
          teacher_id: newLabTeacherId ? Number(newLabTeacherId) : null,
          accepts_submissions: newLabAccepts,
          submission_deadline: newLabAccepts ? fromLocalInput(newLabDeadline) : null
        })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Лаб үүсгэж чадсангүй.")
      return
    }

    try {
      await uploadLabFiles(data.id, labFiles)
      setMessage("Амжилттай лаб үүсгэж чадлаа!")
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Лаб үүслээ, гэхдээ file байрлуулж чадсангүй: ${error.message}`
          : "file байрлуулж чадсангүй."
      )
    }

    setNewLabTitle("")
    setNewLabDescription("")
    setNewLabSubjectId("")
    setNewLabTeacherId("")
    setNewLabAccepts(false)
    setNewLabDeadline("")
    setLabFiles([])
    // the file input is not controlled by React, so clear it here
    form.reset()

    await loadSubjects(token)
  }

  async function loadAllAdminLabs() {
    const token = localStorage.getItem("token")

    if (!token) {
      return
    }

    try {
      const response = await fetch(
        `${API_URL}/admin/labs${schoolQuery()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (!response.ok) {
        setMessage("Лабуудыг ачаалж чадсангүй")
        return
      }

      setAdminLabs(await response.json())
    } catch {
      setMessage("Лабуудыг ачаалж чадсангүй")
    }
  }

  function startEditingLab(lab: Lab) {
    setEditingLab(lab)
    setEditLabTitle(lab.title)
    setEditLabDescription(lab.description || "")
    setEditLabSubjectId(String(lab.subject_id))
    setEditLabTeacherId(lab.teacher_id ? String(lab.teacher_id) : "")
    setEditLabAccepts(lab.accepts_submissions)
    setEditLabDeadline(toLocalInput(lab.submission_deadline))
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
          description: editLabDescription,
          teacher_id: editLabTeacherId ? Number(editLabTeacherId) : null,
          accepts_submissions: editLabAccepts,
          submission_deadline: editLabAccepts ? fromLocalInput(editLabDeadline) : null
        })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setMessage(data.detail || "Лабыг байршуулж чадсангүй.")
      return
    }

    setMessage("Лабыг шинэчиллээ!")

    setEditingLab(null)

    await loadSubjects(token)
  }

  function backToSubjects() {
    setSelectedSubject(null)
    setSelectedTeacherKey(null)
    setLabs([])
    setSelectedLab(null)
  }

  function backToLabs() {
    setSelectedLab(null)
  }

  // switch between the admin dashboard and the student view
  function switchView(asStudent: boolean) {
    backToSubjects()
    setEditingLab(null)
    setEditingSubject(null)
    setEditingTeacher(null)
    setSubmissionsLab(null)
    setMessage("")
    setViewAsStudent(asStudent)

    // show exactly what a student of this school sees right now
    const token = localStorage.getItem("token")
    if (asStudent && token) {
      void loadSubjects(token)
      void loadAllLabs(token)
    }
  }

  function logout() {
    const token = localStorage.getItem("token")

    // record the logout in the activity log; never block logging out on it
    if (token) {
      void fetch(`${API_URL}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    }

    localStorage.removeItem("token")

    setUser(null)
    setSchoolId(null)
    setSchools([])
    setSchoolTeachers([])
    setSubjects([])
    setSelectedSubject(null)
    setLabs([])
    setSelectedLab(null)
    setAdminLabs([])
    setEditingLab(null)
    setSubmissionsLab(null)
    setAllLabs([])
    setSearch("")
    setViewAsStudent(false)
    setShowChangePassword(false)
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
        <h1>The Edenlock</h1>
        <h4>“Code is read much more often than it is written.”</h4>  
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
        <h6>Unlock,Understand,Use</h6>
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

  if (user.must_change_password || showChangePassword) {
    return (
      <ChangePassword
        forced={user.must_change_password}
        onDone={() => {
          setShowChangePassword(false)
          setMessage("")
          setUser({ ...user, must_change_password: false })
        }}
        onCancel={() =>
          user.must_change_password ? logout() : setShowChangePassword(false)
        }
      />
    )
  }

  if (isAdmin(user) && !viewAsStudent) {
    const visibleLabs = labFilter
      ? adminLabs.filter((lab) => String(lab.subject_id) === labFilter)
      : adminLabs
    const tabs = ADMIN_TABS.filter((tab) => tabsFor(user.role).includes(tab.id))
    const subjectTeachers = (subjectId: string) =>
      subjects.find((subject) => String(subject.id) === subjectId)?.teachers ?? []

    return (
      <div>
        <header className="topbar">
          <h1>Админ dashboard</h1>

          <div className="topbar-right">
            {user.role === "platform_admin" ? (
              <select
                aria-label="Сургууль сонгох"
                value={schoolId ?? ""}
                onChange={(event) => {
                  setSchoolId(Number(event.target.value) || null)
                  setLabFilter("")
                  setEditingLab(null)
                  setEditingSubject(null)
                  setEditingTeacher(null)
                  setSubmissionsLab(null)
                  setMessage("")
                }}
              >
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            ) : (
              user.school_name && (
                <span className="topbar-user">{user.school_name}</span>
              )
            )}

            <span className="topbar-user">
              Тавтай морил, <strong>{user.username}</strong>!
            </span>

            <button onClick={() => switchView(true)}>
              Сурагчийн харагдац
            </button>

            <button onClick={() => setShowChangePassword(true)}>
              Нууц үг солих
            </button>

            <button onClick={logout}>
              Бүртгэлээс гарах
            </button>
          </div>
        </header>

        <nav className="tabs" role="tablist" aria-label="Админ цэс">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={adminTab === tab.id}
              className={adminTab === tab.id ? "tab active" : "tab"}
              onClick={() => {
                setAdminTab(tab.id)
                setSubmissionsLab(null)
                setMessage("")
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {adminTab === "schools" && (
          <section className="win">
            <h2 className="win-title">Сургуулиуд</h2>

            <div className="win-body">
              <form className="inline-form" onSubmit={saveSchool}>
                <input
                  type="text"
                  placeholder="Сургуулийн нэр"
                  value={editingSchool ? editSchoolName : newSchoolName}
                  onChange={(event) =>
                    editingSchool
                      ? setEditSchoolName(event.target.value)
                      : setNewSchoolName(event.target.value)
                  }
                />

                <button type="submit">
                  {editingSchool ? "Хадгалах" : "Сургууль нэмэх"}
                </button>

                {editingSchool && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSchool(null)
                      setEditSchoolName("")
                    }}
                  >
                    Цуцлах
                  </button>
                )}
              </form>

              <ul className="admin-list">
                {schools.map((school) => (
                  <li key={school.id}>
                    <span className="admin-list-main">
                      {school.name}
                      {school.id === schoolId && (
                        <span className="badge">сонгосон</span>
                      )}
                    </span>

                    <span className="row-actions">
                      <button onClick={() => setSchoolId(school.id)}>
                        Сонгох
                      </button>

                      <button
                        onClick={() => {
                          setEditingSchool(school)
                          setEditSchoolName(school.name)
                          setMessage("")
                        }}
                      >
                        Шинэчлэх
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {adminTab === "teachers" && (
          <section className="win">
            <h2 className="win-title">Багш нар</h2>

            <div className="win-body">
              <form className="inline-form" onSubmit={saveTeacher}>
                <input
                  type="text"
                  placeholder="Багшийн нэр"
                  value={editingTeacher ? editTeacherName : newTeacherName}
                  onChange={(event) =>
                    editingTeacher
                      ? setEditTeacherName(event.target.value)
                      : setNewTeacherName(event.target.value)
                  }
                />

                <button type="submit">
                  {editingTeacher ? "Хадгалах" : "Багш нэмэх"}
                </button>

                {editingTeacher && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTeacher(null)
                      setEditTeacherName("")
                    }}
                  >
                    Цуцлах
                  </button>
                )}
              </form>

              {schoolTeachers.length === 0 ? (
                <p>Багш алга.</p>
              ) : (
                <ul className="admin-list">
                  {schoolTeachers.map((teacher) => (
                    <li key={teacher.id}>
                      <span className="admin-list-main">
                        {teacher.name}

                        <small className="block">
                          {subjects
                            .filter((subject) =>
                              subject.teachers.some((t) => t.id === teacher.id)
                            )
                            .map((subject) => subject.name)
                            .join(", ") || "Хичээлгүй"}
                        </small>
                      </span>

                      <span className="row-actions">
                        <button
                          onClick={() => {
                            setEditingTeacher(teacher)
                            setEditTeacherName(teacher.name)
                            setMessage("")
                          }}
                        >
                          Шинэчлэх
                        </button>

                        <button onClick={() => deleteTeacher(teacher)}>
                          Устгах
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {adminTab === "subjects" && (
          <section className="win">
            <h2 className="win-title">Хичээлүүд</h2>

            <div className="win-body">
              <form className="form-grid" onSubmit={createSubject}>
                <div className="span-2">
                  <input
                    type="text"
                    placeholder="Хичээллийн нэр"
                    value={newSubjectName}
                    onChange={(event) =>
                      setNewSubjectName(event.target.value)
                    }
                  />
                </div>

                <div className="span-2">
                  <label>Багш нар</label>

                  <TeacherPicker
                    teachers={schoolTeachers}
                    selected={newSubjectTeacherIds}
                    onChange={setNewSubjectTeacherIds}
                  />
                </div>

                <div className="span-2">
                  <button type="submit">
                    хичээлийг нэмэх
                  </button>
                </div>
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

                          <TeacherPicker
                            teachers={schoolTeachers}
                            selected={editSubjectTeacherIds}
                            onChange={setEditSubjectTeacherIds}
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

                            <small className="block">
                              {subject.teachers.length
                                ? `Багш: ${teacherNames(subject)}`
                                : "Багш томилоогүй"}
                            </small>
                          </span>

                          <span className="row-actions">
                            <button
                              onClick={() => {
                                setEditingSubject(subject)
                                setEditSubjectName(subject.name)
                                setEditSubjectTeacherIds(
                                  subject.teachers.map((teacher) => teacher.id)
                                )
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

        {adminTab === "labs" && submissionsLab && (
          <LabSubmissions
            key={submissionsLab.id}
            lab={submissionsLab}
            onClose={() => setSubmissionsLab(null)}
          />
        )}

        {adminTab === "labs" && !submissionsLab && (
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
                      onChange={(event) => {
                        setEditLabSubjectId(event.target.value)
                        setEditLabTeacherId("")
                      }}
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
                    <label>Багш</label>

                    <select
                      value={editLabTeacherId}
                      onChange={(event) =>
                        setEditLabTeacherId(event.target.value)
                      }
                    >
                      <option value="">Багшгүй</option>

                      {subjectTeachers(editLabSubjectId).map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
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
                    <SubmissionSettings
                      accepts={editLabAccepts}
                      deadline={editLabDeadline}
                      onChange={(accepts, deadline) => {
                        setEditLabAccepts(accepts)
                        setEditLabDeadline(deadline)
                      }}
                    />
                  </div>

                  <div className="span-2">
                    <label>File-ууд (нэмэх, устгах нь шууд хадгалагдана)</label>

                    <LabFileManager
                      lab={editingLab}
                      onChange={(lab) => {
                        setEditingLab(lab)
                        setAdminLabs((current) =>
                          current.map((item) => (item.id === lab.id ? lab : item))
                        )
                      }}
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
                          onChange={(event) => {
                            setNewLabSubjectId(event.target.value)
                            setNewLabTeacherId("")
                          }}
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
                        <label>Багш</label>

                        <select
                          value={newLabTeacherId}
                          onChange={(event) =>
                            setNewLabTeacherId(event.target.value)
                          }
                        >
                          <option value="">Багшгүй</option>

                          {subjectTeachers(newLabSubjectId).map((teacher) => (
                            <option key={teacher.id} value={teacher.id}>
                              {teacher.name}
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
                        <SubmissionSettings
                          accepts={newLabAccepts}
                          deadline={newLabDeadline}
                          onChange={(accepts, deadline) => {
                            setNewLabAccepts(accepts)
                            setNewLabDeadline(deadline)
                          }}
                        />
                      </div>

                      <div className="span-2">
                        <label>Лабын file-ууд (хэд хэдийг сонгож болно)</label>

                        <input
                          type="file"
                          multiple
                          onChange={(event) =>
                            setLabFiles(Array.from(event.target.files ?? []))
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

                            <span className="badge">
                              {lab.teacher_name ?? "Багшгүй"}
                            </span>

                            {lab.accepts_submissions && (
                              <span className="badge">
                                {lab.submissions_open
                                  ? "Илгээлт нээлттэй"
                                  : "Илгээх хугацаа дууссан"}
                              </span>
                            )}

                            {lab.description && (
                              <small className="block">
                                {lab.description}
                              </small>
                            )}

                            <small className="block">
                              {lab.files.length
                                ? `📎 ${fileNames(lab)}`
                                : "file оруулаагүй"}
                            </small>
                          </span>

                          <span className="row-actions">
                            <button onClick={() => setSubmissionsLab(lab)}>
                              Илгээлтүүд
                            </button>

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

        {(adminTab === "users" || adminTab === "emails") && (
          <AdminUsers
            key={adminTab}
            section={adminTab}
            currentUserId={user.id}
            schoolId={user.role === "platform_admin" ? schoolId : null}
            schools={user.role === "platform_admin" ? schools : []}
          />
        )}

        {adminTab === "log" && (
          <ActivityLog
            schoolId={user.role === "platform_admin" ? schoolId : null}
          />
        )}

        <p>{message}</p>
      </div>
    )
  }

  // shown on every student screen while an admin previews it
  const previewSchool = user.role === "platform_admin"
    ? schools.find((school) => school.id === schoolId)?.name
    : user.school_name
  const previewBanner = isAdmin(user) && (
    <div className="preview-banner" role="status">
      <span>
        Та сурагчийн харагдацыг үзэж байна{previewSchool && ` (${previewSchool})`}
      </span>
      <button onClick={() => switchView(false)}>
        ← Админ руу буцах
      </button>
    </div>
  )

  // a lab as a tile, on the subject page and in search results
  const labTile = (lab: Lab, onClick: () => void, subjectName?: string) => (
    <button key={lab.id} className="tile" onClick={onClick}>
      <span className="tile-title">{lab.title}</span>
      {subjectName && (
        <span className="tile-desc">
          {subjectName}
          {lab.teacher_name && ` · ${lab.teacher_name}`}
        </span>
      )}
      {lab.description && (
        <span className="tile-desc">{lab.description}</span>
      )}
      <span className="tile-badges">
        {isNew(lab) && <span className="tile-badge new">Шинэ</span>}
        {lab.files.length > 0 && (
          <span className="tile-badge">{lab.files.length} файл</span>
        )}
      </span>
    </button>
  )

  // search: lab title, description, teacher or subject name
  const searchText = search.trim().toLowerCase()
  const searchResults = searchText
    ? allLabs.filter((lab) =>
        [
          lab.title,
          lab.description,
          lab.teacher_name,
          subjects.find((subject) => subject.id === lab.subject_id)?.name,
        ].some((text) => text?.toLowerCase().includes(searchText))
      )
    : []

  async function openFromSearch(lab: Lab) {
    const subject = subjects.find((item) => item.id === lab.subject_id)
    if (!subject) return

    await openSubject(subject)
    // "back" from the lab returns to this teacher's labs
    setSelectedTeacherKey(lab.teacher_id ? String(lab.teacher_id) : "none")
    await openLab(lab)
  }

  if (selectedLab) {
    return (
      <div>
        {previewBanner}
        <header className="topbar">
          <h1>The Edenlock</h1>
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

        <LabFileList
          key={selectedLab.id}
          labId={selectedLab.id}
          files={selectedLab.files}
        />

        {selectedLab.accepts_submissions && (
          <LabSubmission
            key={selectedLab.id}
            labId={selectedLab.id}
            canSubmit={user.role === "student"}
            open={selectedLab.submissions_open}
            deadline={selectedLab.submission_deadline}
          />
        )}

        <p>{message}</p>
      </div>
    )
  }

  if (selectedSubject) {
    const groups = teacherGroups(selectedSubject, labs)
    const selectedGroup = groups.find((group) => group.key === selectedTeacherKey)
    // a subject with one teacher skips straight to the labs
    const canPickTeacher = groups.length > 1

    return (
      <div>
        {previewBanner}
        <header className="topbar">
          <h1>The Edenlock</h1>
        </header>

        <section className="subhead">
          {selectedGroup && canPickTeacher ? (
            <button onClick={() => setSelectedTeacherKey(null)}>
              ← Багш нар руу буцах
            </button>
          ) : (
            <button onClick={backToSubjects}>
              ← Хичээл руу буцах
            </button>
          )}
          <h2>
            {selectedSubject.name}
            {selectedGroup && selectedGroup.key !== "none" && ` · ${selectedGroup.name}`}
          </h2>
        </section>

        {groups.length === 0 ? (
          <p>Ямарч лаб байхгүй байна.</p>
        ) : !selectedGroup ? (
          <section className="tile-grid">
            {groups.map((group) => (
              <button
                key={group.key}
                className="tile"
                onClick={() => setSelectedTeacherKey(group.key)}
              >
                <span className="tile-title">{group.name}</span>
                <span className="tile-badges">
                  {countNew(group.labs) > 0 && (
                    <span className="tile-badge new">{countNew(group.labs)} шинэ</span>
                  )}
                  <span className="tile-badge">{group.labs.length} лаб</span>
                </span>
              </button>
            ))}
          </section>
        ) : selectedGroup.labs.length === 0 ? (
          <p>Энэ багш одоохондоо лаб оруулаагүй байна.</p>
        ) : (
          <section className="tile-grid">
            {selectedGroup.labs.map((lab) => labTile(lab, () => openLab(lab)))}
          </section>
        )}
      </div>
    )
  }

  return (
    <div>
      {previewBanner}
      <header className="topbar">
        <h1>The Edenlock</h1>

        <div className="topbar-right">
          <span className="topbar-user">
            Тавтай морил, <strong>{user.username}</strong>!
          </span>

          {!isAdmin(user) && (
            <button onClick={() => setShowChangePassword(true)}>
              Нууц үг солих
            </button>
          )}

          <button onClick={logout}>
            Бүртгэлээс гарах
          </button>
        </div>
      </header>

      <div className="inline-form lab-search">
        <input
          type="search"
          aria-label="Лаб хайх"
          placeholder="🔍 Лаб хайх: нэр, багш, хичээл..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {searchText ? (
        <>
          <h2>Хайлтын үр дүн</h2>

          {searchResults.length === 0 ? (
            <p>"{search.trim()}" олдсонгүй.</p>
          ) : (
            <section className="tile-grid">
              {searchResults.map((lab) =>
                labTile(
                  lab,
                  () => openFromSearch(lab),
                  subjects.find((subject) => subject.id === lab.subject_id)?.name
                )
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <h2>Хичээлүүд</h2>

          {subjects.length === 0 ? (
            <p>Ямарч хичээл алга.</p>
          ) : (
            <section className="tile-grid">
              {subjects.map((subject) => {
                const newLabs = countNew(
                  allLabs.filter((lab) => lab.subject_id === subject.id)
                )

                return (
                  <button
                    key={subject.id}
                    className="tile"
                    onClick={() => openSubject(subject)}
                  >
                    <span className="tile-title">{subject.name}</span>
                    {subject.teachers.length > 0 && (
                      <span className="tile-desc">{teacherNames(subject)}</span>
                    )}
                    {newLabs > 0 && (
                      <span className="tile-badge new">{newLabs} шинэ лаб</span>
                    )}
                  </button>
                )
              })}
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default App