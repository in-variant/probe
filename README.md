# Probe

Monorepo with two services: a Next.js frontend and a FastAPI backend.

## Frontend (`/frontend`)

- **Next.js 16** (App Router, Turbopack)
- **Tailwind CSS v4** (CSS-first config via `@import "tailwindcss"`)
- **Lucide React** icons
- **Geist / Geist Mono** fonts
- Hand-styled components — no external component library

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

## Backend (`/backend`)

- **FastAPI** with CORS configured for the frontend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload   # http://localhost:8000
```

### API

| Method | Path          | Description  |
|--------|---------------|--------------|
| GET    | `/api/health` | Health check |
