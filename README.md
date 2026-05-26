# wordle-rooms

A real-time multiplayer Wordle game where players compete in shared rooms. Built with a Go backend, Next.js frontend, and Postgres.

## Prerequisites

- [Go](https://go.dev/dl/) 1.22+
- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/installation)
- [Docker](https://docs.docker.com/get-docker/) (for Postgres)

## Quick start

```bash
# 1. Start Postgres
make up

# 2. In a second terminal — start the Go backend
make backend

# 3. In a third terminal — start the Next.js frontend
make frontend
```

- Frontend: http://localhost:3000 — shows "wordle-rooms" and the live backend health status
- Backend health: http://localhost:8080/api/health — returns `{"status":"ok"}`

## Project structure

```
wordle-rooms/
├── backend/
│   ├── cmd/server/main.go   # Go entry point
│   └── go.mod
├── frontend/                # Next.js app (App Router, TypeScript, Tailwind)
│   └── src/app/page.tsx
├── docker-compose.yml       # Postgres only — backend/frontend run on host
├── Makefile                 # Dev workflow targets
├── .env.example             # Environment variable reference
└── README.md
```

## Available make targets

```
make help       # list all targets
make up         # start Postgres
make down       # stop Postgres
make backend    # run Go server on :8080
make frontend   # run Next.js dev server on :3000
make db         # open psql shell in running Postgres container
make tidy       # go mod tidy
```

---

**Current phase: 0 — scaffolding.** No game logic, rooms, or database schema yet.
