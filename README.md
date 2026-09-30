# Student Platform

A web platform for sharing and accessing university student labs, coursework, and learning resources.

The project consists of a React + TypeScript frontend and a FastAPI backend.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Getting Started](#getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Backend Setup](#2-backend-setup)
  - [3. Frontend Setup](#3-frontend-setup)
- [Running the Project](#running-the-project)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Development Workflow](#development-workflow)
- [Contributing](#contributing)
- [Security Notes](#security-notes)
- [Current Development Status](#current-development-status)
- [License](#license)

---

## Tech Stack

### Frontend

- React
- TypeScript
- Vite

### Backend

- Python
- FastAPI
- SQLAlchemy
- SQLite
- JWT Authentication
- bcrypt

---

## Project Structure

```text
student-platform/
│
├── backend/
│   ├── .env.example
│   ├── requirements.txt
│   ├── auth.py
│   ├── database.py
│   ├── main.py
│   ├── models.py
│   └── schemas.py
│
├── frontend/
│   ├── .env.example
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.ts
│
├── .gitignore
└── README.md
```

Local files such as `.env`, the SQLite database, uploaded files, virtual environments, `node_modules`, and build output are intentionally ignored by Git.

---

# Requirements

Before setting up the project, install:

- Git
- Python 3.10+
- Node.js 18+
- npm

Check your installed versions:

```bash
git --version
python --version
node --version
npm --version
```

---

# Getting Started

## 1. Clone the Repository

Clone the repository from GitHub:

```bash
git clone https://github.com/dedu-edu/student-platform.git
```

Move into the project directory:

```bash
cd student-platform
```

---

# 2. Backend Setup

The backend provides the API, authentication, database access, and lab/file functionality.

## 2.1 Move into the Backend Directory

```bash
cd backend
```

## 2.2 Create a Python Virtual Environment

```bash
python -m venv .venv
```

### Windows PowerShell

```powershell
.venv\Scripts\Activate.ps1
```

### Windows Command Prompt

```cmd
.venv\Scripts\activate
```

### macOS / Linux

```bash
source .venv/bin/activate
```

## 2.3 Install Backend Dependencies

```bash
pip install -r requirements.txt
```

## 2.4 Configure Backend Environment Variables

Create a `.env` file inside the `backend` directory.

### Windows

```powershell
copy .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Your `backend/.env` should contain:

```env
SECRET_KEY=your-secret-key
DATABASE_URL=sqlite:///./student_platform.db
```

Generate a secure secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put the generated value into `SECRET_KEY`.

Never commit your real `.env` file.

## 2.5 Start the Backend

From the `backend` directory:

```bash
uvicorn main:app --reload
```

Backend:

```text
http://127.0.0.1:8000
```

---

# 3. Frontend Setup

Open a second terminal while leaving the backend running.

## 3.1 Move into the Frontend Directory

From the project root:

```bash
cd frontend
```

If you are currently inside `backend`:

```bash
cd ../frontend
```

## 3.2 Install Frontend Dependencies

```bash
npm install
```

## 3.3 Configure the Frontend

Create:

```text
frontend/.env
```

### Windows

```powershell
copy .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

Put this inside:

```env
VITE_API_URL=http://127.0.0.1:8000
```

This tells the frontend where the FastAPI backend is running.

Do not commit `frontend/.env`.

## 3.4 Start the Frontend

```bash
npm run dev
```

The frontend will normally be available at:

```text
http://localhost:5173
```

---

# Running the Project

Two terminals are required.

## Terminal 1 — Backend

```bash
cd student-platform/backend
```

Activate the virtual environment, then:

```bash
uvicorn main:app --reload
```

## Terminal 2 — Frontend

```bash
cd student-platform/frontend
npm run dev
```

Open:

```text
http://localhost:5173
```

---

# Environment Variables

## Backend

File:

```text
backend/.env
```

```env
SECRET_KEY=your-generated-secret
DATABASE_URL=sqlite:///./student_platform.db
```

Template:

```text
backend/.env.example
```

## Frontend

File:

```text
frontend/.env
```

```env
VITE_API_URL=http://127.0.0.1:8000
```

Template:

```text
frontend/.env.example
```

The `.env.example` files are safe to commit because they contain templates rather than real secrets.

---

# API Documentation

With the backend running, open:

```text
http://127.0.0.1:8000/docs
```

The API currently provides functionality for:

- User registration
- User login
- JWT authentication
- Current-user information
- Allowed registration emails
- Subjects
- Labs
- Lab creation
- Lab editing
- Lab file uploads
- Lab file replacement
- Lab file downloads
- Admin functionality

---

# Development Workflow

Create a feature branch:

```bash
git checkout -b feature/my-feature
```

Make and test your changes.

Check:

```bash
git status
```

Stage:

```bash
git add .
```

Commit:

```bash
git commit -m "Add my feature"
```

Push:

```bash
git push -u origin feature/my-feature
```

Then open a Pull Request on GitHub.

---

# Contributing

Contributions are welcome.

Before opening a Pull Request:

1. Make sure the backend starts successfully.
2. Make sure the frontend starts successfully.
3. Test the functionality you changed.
4. Do not commit `.env` files.
5. Do not commit database files.
6. Do not commit uploaded files.
7. Do not commit `node_modules`.
8. Keep commits focused on a specific change.
9. Use descriptive branch names.
10. Explain what your Pull Request changes.

---

# Security Notes

Never commit secrets or private configuration to GitHub.

Do not commit:

```text
backend/.env
frontend/.env
```

Do not put real production secrets into:

```text
backend/.env.example
frontend/.env.example
```

If a secret is accidentally exposed, replace or rotate it immediately.

The current SQLite database and local file storage are intended for development. Production deployment will use a production database and persistent file storage.

---

# Current Development Status

Current functionality includes:

- User registration
- Login and JWT authentication
- User information
- Admin access
- Allowed-email registration control
- Subject management
- Lab creation
- Lab editing
- Lab file upload
- Lab file replacement
- Lab file download
- Student dashboard
- Admin dashboard
- React frontend
- FastAPI backend
- Local SQLite development database
- Environment-based API configuration

The project is currently being prepared for public deployment.

Planned production work includes:

- PostgreSQL
- Persistent/cloud file storage
- Production environment configuration
- Production CORS configuration
- HTTPS
- Public frontend deployment
- Public backend deployment
- Domain configuration
- Additional production security and validation

---

# License

License information will be added as the project develops.
