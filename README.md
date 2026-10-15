# DB-Agent Test UI

A self-contained chat UI for manually testing the DB-Agent module. It handles user authentication, chat session persistence (via Prisma + Postgres), and streams answers from `DatabaseAgent`.

The chat model and the database the agent reads come from QueryFabric `backend/.env` (`DB_AGENT_*` and `ASK_CHAT_HISTORY_MESSAGE_LIMIT`). Users, conversations, workflow tests, and results stay in the test UI database (`TESTUI_DATABASE_URL`).

## Quick start (QueryFabric repo root)

Run testui in a **second terminal** while the main app uses its own stack:

```bash
./scripts/start-testui.sh
```

This script starts **testui's Docker Postgres** (port **5555**), applies Prisma migrations, then runs dev (**5173** + **4000**). Dev loads the test UI `.env`, then `backend/.env`. Bun lets the later file replace shared names, so the model, API key, and query database match the main app. `TESTUI_DATABASE_URL` and `TESTUI_SESSION_SECRET` stay from the test UI `.env`.

Optional flag: `--docker-only` (Postgres + migrate + seed, no Vite). The start script always seeds the login user.

If the test UI `.env` is missing, the script creates one with the database URL and session secret.

## Prerequisites

- [Bun](https://bun.sh)
- [Docker](https://www.docker.com) (for the app Postgres)

## Setup (manual)

```bash
cd backend/src/features/DB-Agent/testui
cp .env.example .env
```

The test UI `.env` only needs the app database and session secret. The chat model, API key, and query database are read from `backend/.env`.

Minimum for manual setup:

1. Set `TESTUI_SESSION_SECRET` to a long random string (16+ characters).
2. Set `TESTUI_DATABASE_URL` to match Docker (see `.env.example`).
3. Set `DB_AGENT_DB_URI`, the chat model, and the API key in `backend/.env`.

Start the app database:

```bash
bun run docker:up
```

Install dependencies, run migrations, and seed the default test user:

```bash
bun install
bun run prisma:migrate
bun run prisma:seed
```

Or run all database setup in one step (Docker + migrate + seed):

```bash
bun run db:setup
```

**Default seeded user:** `rahul@test.com` / `1234`

## Development

```bash
bun run dev
```

This starts:

- **API server** on `http://localhost:4000`
- **Vite dev server** on `http://localhost:5173` (proxies `/api` to the API)

Open **http://localhost:5173** in your browser.

## Production build

```bash
bun run build
NODE_ENV=production bun run start
```

Serves the built client and API from port `4000` (or `TESTUI_PORT`).

## API endpoints

| Method | Route | Description |
| ------ | ----- | ----------- |
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Log in (sets session cookie) |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/me` | Current user |
| GET | `/api/conversations` | List conversations |
| POST | `/api/conversations` | Create conversation |
| PATCH | `/api/conversations/:id` | Rename conversation |
| GET | `/api/conversations/:id/messages` | Load messages |
| POST | `/api/conversations/:id/messages` | Send message (SSE stream) |
| DELETE | `/api/conversations/:id` | Delete conversation |

## Architecture

- **App DB** (Docker Postgres on port 5555): users, sessions, conversations, workflow tests, and results via Prisma.
- **Query DB** (`DB_AGENT_DB_URI` in `backend/.env`): the only database the agent reads. Chat and each suite item use the same `DatabaseAgent` call as the main app, including the startup schema in the SQL system prompt and the last `ASK_CHAT_HISTORY_MESSAGE_LIMIT` messages.
- **Agent**: imported from `../../index.js`. The model and API key come from `backend/.env`.

## Troubleshooting

- **Invalid environment**: set `TESTUI_DATABASE_URL` and `TESTUI_SESSION_SECRET` in the test UI `.env`, and the chat model plus `DB_AGENT_DB_URI` in `backend/.env`.
- **Database connection errors**: run `docker compose ps` and confirm Postgres is healthy on port 5555.
- **Agent DB errors**: confirm `DB_AGENT_DB_URI` is reachable from the server and restart so the startup schema can load.
