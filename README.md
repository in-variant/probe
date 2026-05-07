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
uvicorn main:app --reload --port 8080   # http://localhost:8080
```

### Testing

Run the backend test suite from the `backend/` directory:

```bash
cd backend
pytest                        # run all tests
pytest -v                     # verbose output
pytest --cov=. --cov-report=term-missing   # with coverage report
```

CI enforces a minimum of **70%** code coverage. The workflow runs automatically on pushes to `main` and on pull requests that touch `backend/`.

### API

| Method | Path          | Description  |
|--------|---------------|--------------|
| GET    | `/api/health` | Health check |
