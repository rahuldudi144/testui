# DB-Agent Test UI

A self-contained chat UI for manually testing the DB-Agent module. It handles user authentication, chat session persistence (via Prisma + Postgres), and streams answers from `DatabaseAgent`.

The agent's **target database** is chosen in the UI (saved connections per user), not via QueryFabric `backend/.env`.

## Quick start (QueryFabric repo root)

Run testui in a **second terminal** while the main app uses its own stack:

```bash
./scripts/start-testui.sh
```

This script only starts **testui's Docker Postgres** (port **5555**), applies Prisma migrations, then runs dev (**5173** + **4000**). Agents, LLM keys, and databases you query are configured in **Settings** inside testui and stored in testui's database.

Optional flag: `--docker-only` (Postgres + migrate + seed, no Vite). The start script always seeds the login user.

If `testui/.env` is missing, the script creates a **minimal** boot `.env` (app DB URL + session secret + `ollama` default). It does **not** copy `.env.example` or sync main-app secrets.

## Prerequisites

- [Bun](https://bun.sh)
- [Docker](https://www.docker.com) (for the app Postgres)

## Setup (manual)

```bash
cd backend/src/features/DB-Agent/testui
cp .env.example .env
```

Edit `.env` if you need server-wide LLM defaults (optional). **Per-user agents and database connections are configured in the UI** and saved in testui Postgres.

Minimum for manual setup:

1. Set `TESTUI_SESSION_SECRET` to a long random string (16+ characters).
2. Set `TESTUI_DATABASE_URL` to match Docker (see `.env.example`).
3. Set provider/API key vars only if you rely on env defaults instead of Settings → Agents.

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

- **App DB** (Docker Postgres on port 5555): users, conversations, message history, and **per-user database connections** via Prisma.
- **Agent target DB** (configured in UI): each user saves PostgreSQL/MySQL connection URIs; the active connection is used when chatting.
- **Agent LLM**: per-user agent profiles in Settings (env vars are optional fallbacks).
- **Agent**: imported from `../../index.js` — stateless; the test UI owns session, history, and DB config persistence.

## Database connections (UI)

Each user can save multiple database connections (PostgreSQL or MySQL) from the **right panel**:

1. Log in
2. Open the Database panel (right side)
3. Enter name, engine, and connection URI
4. Click **Test connection**, then **Save & activate**
5. Start chatting — the agent uses your active connection

## Settings

Open **Settings** from the sidebar or chat toolbar:

- **Database** — add, test, activate, and delete PostgreSQL/MySQL connections (saved per user)
- **Users** — view all test users, create accounts, change your password, delete other users

| Method | Route | Description |
| ------ | ----- | ----------- |
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user |
| DELETE | `/api/users/:id` | Delete user |
| PATCH | `/api/users/me/password` | Change your password |

## Troubleshooting

- **Invalid environment**: ensure all required vars in `.env.example` are set.
- **Database connection errors**: run `docker compose ps` and confirm Postgres is healthy on port 5555.
- **Agent DB errors**: in Settings, test and activate a saved connection; ensure the URI is reachable from the server.
