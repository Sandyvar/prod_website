# Productivity

A personal productivity app: a kanban **Tasks** board (with List and Calendar views, scheduling and repeating tasks) and a **Memory** section for people, projects, glossary terms and markdown notes. Light and dark themes.

React + Vite + TypeScript on the front (plain CSS, date-fns, lucide-react, @dnd-kit), Express + TypeScript + SQLite (better-sqlite3) on the back.

## Requirements

- Node.js **20.19+** (tested on Node 24)
- npm 10+

## Setup

```bash
npm install
cp .env.example .env   # already done for you; fill in Google keys if you want Google sign-in
```

## Run (development)

```bash
npm run dev
```

Then open **http://localhost:5173**. This starts both:

| Process | URL                   | Notes                                |
| ------- | --------------------- | ------------------------------------ |
| Client  | http://localhost:5173 | Vite dev server with hot reload      |
| API     | http://localhost:3001 | Express; Vite proxies `/api/*` to it |

You'll land on the welcome screen. Sign up, sign in, or **Continue as guest**. Every new account or guest starts with 6 example tasks (2 of them scheduled, one repeating weekly), a person, a project, a glossary term and a welcome note.

The database is `./data/app.db`. To start completely fresh, stop the app and delete the `data/` folder.

**Upgrading:** databases from earlier versions are upgraded automatically. Data created before accounts existed belongs to the **first user** who signs up or continues as a guest. "Someday" tasks move to Active and "med" priority becomes "medium".

## Accounts and sign-in

- **Email + password:** passwords are hashed with bcrypt (via `bcryptjs`, cost 12). Signing in sets an `HttpOnly`, `SameSite=Lax` session cookie (30 days). Only a SHA-256 hash of the session token is stored, so a leaked database can't be used to hijack sessions.
- **Google:** OAuth 2.0 authorization-code flow with a `state` check. If the Google email matches an existing account, the two are linked. Setup:
  1. In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type *Web application*.
  2. Add the authorized redirect URI `http://localhost:5173/api/auth/google/callback` for dev, or `<APP_URL>/api/auth/google/callback` in production.
  3. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart `npm run dev`.

  Until then, the Google button explains what's missing.
- **Guest mode:**
  - "Continue as guest" creates a guest user kept by a 1-year cookie in this browser, so the data is only reachable from this device.
  - From **Settings → Account**, a guest can **Create account**, which turns the guest into a real account with everything kept, or **Sign in** to an existing account, which moves the guest's data into it. Example items the guest never touched aren't copied, so nothing appears twice.
  - Signing out of guest mode asks for confirmation first, because guest data can't be reached again afterwards.
- **Forgot password:** creates a one-time reset link, valid for 30 minutes. **No email service is configured**, so the link is printed in the server console (`[password reset] …`). Wire an email provider into `server/src/routes/auth.ts` (`/forgot`) to send it instead. Resetting signs the user out everywhere else.
- **Isolation:** every table carries a `user_id`, and every query is filtered by it. Another user's id behaves exactly like one that doesn't exist (404), and tasks can only link to your own people and projects.
- **Hardening:**
  - Login and reset requests are rate-limited (10 / 5 per 15 minutes per IP and email).
  - The login error never reveals whether an email is registered.
  - State-changing requests with a foreign `Origin` are rejected.
  - Cookies get the `Secure` flag automatically when `APP_URL` starts with `https://`.

## Tests

```bash
npm test          # API tests (vitest + supertest, in-memory SQLite)
npm run typecheck # TypeScript checks for server and client
```

## Production / deploy

```bash
npm run build     # builds the client into client/dist
npm start         # serves API + built client on PORT (default 3001)
```

Settings come from `.env` (loaded automatically) or real environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | Enable Google sign-in |
| `APP_URL` | dev `http://localhost:5173`, prod `http://localhost:$PORT` | Public URL: Google redirect URI, reset links, Secure cookies when `https://` |
| `PORT` | `3001` | HTTP port |
| `DB_PATH` | `./data/app.db` | SQLite file location |
| `TRUST_PROXY` | — | Set `true` behind nginx or a load balancer |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |

Deploy to any host with a persistent disk (a VPS, Fly.io or Render with a volume, a home server): run `npm ci && npm run build && npm start` and point `DB_PATH` at the persistent volume. Serverless platforms without a writable disk aren't suitable for SQLite.

When exposing it to the internet:
- Serve it over **HTTPS** and set `APP_URL=https://your.domain`, so cookies are marked Secure.
- Set `TRUST_PROXY=true` if it runs behind a reverse proxy.
- Add the production redirect URI in Google Cloud.

## Features

### Welcome screen

- **Always dark,** with softly twinkling dots and slowly floating outline circles. All of it turns off under `prefers-reduced-motion`.
- **Logo** (`client/src/components/Logo.tsx`): the check mark draws itself, a ring pulse ripples outward, and a light dot orbits the ring every 7 s. The same logo is the favicon (`client/public/icon.svg`) and appears in the app header.
- **Sign-in card:** rises in on load with a slow terracotta glow. It has a sliding **Sign in | Sign up** switch and Google sign-in.
- **Guest flow:** a dashed **Continue as guest** button swaps the card to "What should we call you?". The greeting on the Tasks page uses your account or guest name.

### Tasks

- **Columns:** Active, Scheduled, Waiting On, Done. Each has its own colour (accent, blue, amber, green).
- **Views (header toggle):**
  - **Board** — drag cards within and between columns.
  - **List** — grouped by column; sort by manual order, due date or priority.
  - **Calendar** — month or week view of scheduled and due dates. Drag a task to another day to reschedule it; click a day to see its agenda, or **+** to add a task on that day.
- **Scheduled tasks:**
  - Need a date; the time and the repeat (daily / weekly / monthly) are optional.
  - The column is sorted by date and grouped under Today, Tomorrow, This week and Later.
  - When a task's date and time arrive, it moves to Active automatically (checked on load, every minute, and when you return to the tab) with a toast such as "1 scheduled task is now active".
  - Completing a repeating task creates its next occurrence, always on a future date.
  - Dropping an undated task into Scheduled sets it to tomorrow.
- **Completing a task:** the checkbox animates and the card slides into Done. Finishing the last task of the day sets off a small confetti burst. The toast offers **Undo**, which restores the task's exact position and removes any repeat occurrence it created.
- **Editing and colour cues:**
  - Click a card to edit every field in a side panel; changes save automatically.
  - Overdue dates are red and due-today dates use the accent colour.
  - Waiting On cards show "Waiting X days".
- **Search and filters:** the header search (`/`), plus filters for tag, priority, person, overdue and this week. Clicking the Overdue stat card toggles the overdue filter.
- **Quick-add syntax** in "+ Add a task": `Call Sam #finance !high @Sam` sets a tag, the priority and the person.

### Memory

- **Left menu:** All, People, Projects, Glossary, Notes, each with a count. On smaller screens it turns into horizontal chips.
- **People:** initials avatar, nickname, full name, role, company, email and notes, plus their open tasks.
- **Projects:** status chip, description, related people, and a progress bar based on linked tasks that are done.
- **Glossary:** a table of terms and meanings (e.g. EPBCS = Enterprise Planning and Budgeting Cloud Service).
- **Notes:** markdown with Write and Preview tabs. Rendering is safe: it never inserts raw HTML, and `javascript:` links are blocked.
- **Linking:** tasks link to people and projects, and person/project pages list linked tasks and let you add new ones. A person's tasks also include tasks whose "for" text matches their nickname.

### Settings

- **Your name**, used in the greeting.
- **Theme:** Light, Dark or System.
- **Default task view:** Board, List or Calendar.
- **TASKS.md import/export** and **JSON backup/restore**. A restore replaces all data, including settings.

### Theme

- **First visit:** follows your OS setting (`prefers-color-scheme`).
- **After that:** your choice is saved in the database and in localStorage, so it syncs between browsers and loads without a flash.
- **Switching:** the header switch slides its knob, and colours fade over 200 ms. Press `D` to toggle.
- **Contrast:** checked at ≥ 4.5:1 for all text in both themes.

### Keyboard shortcuts

`N` new task · `/` search · `D` dark mode · `Esc` close panel · `Enter` open focused card · `Space` pick up / drop a focused card

### Responsive

- **Desktop:** four columns.
- **Tablet:** columns scroll sideways.
- **Phone:** columns stack, with a bottom tab bar (Tasks, New, Memory, Settings) and full-screen panels.

## Data, saving and time zones

- Every change goes straight to SQLite through the REST API. The UI updates optimistically and rolls back with an error toast if a save fails.
- Dates are stored as calendar dates (`YYYY-MM-DD`) and times as `HH:mm` in **your local time**. The browser sends its local date and time with each request (`X-Local-Now` header), so the server uses your clock, not the server's, to decide when scheduled tasks become active and when repeats fall.
- Server-side validation (zod) covers every request; invalid input returns `400 { error, details }`.

### TASKS.md format

```markdown
# Tasks

## Active
- [ ] **Task title** - context, for whom, due date

## Scheduled
- [ ] **Task title** - scheduled 2026-11-13 10:00
- [ ] **Pay rent** - scheduled 2026-12-01, repeats monthly

## Waiting On
- [ ] **Task title** - for Legal team

## Done
- [x] ~~Task~~ (2026-11-05)
```

Fields after the dash are comma-separated (`for …`, `due YYYY-MM-DD`, `scheduled YYYY-MM-DD [HH:mm]`, `repeats daily|weekly|monthly`). Anything else is treated as context. Priority, tags and links are kept only in the JSON backup.

## REST API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/auth/config`, `/api/auth/me` | Google enabled? / current user (`{ user: null }` when signed out) |
| POST | `/api/auth/signup`, `/login`, `/guest`, `/logout` | Email/password and guest sessions |
| POST | `/api/auth/forgot`, `/api/auth/reset` | Password reset (link printed in the server console) |
| GET | `/api/auth/google`, `/api/auth/google/callback` | Google OAuth |
| GET / POST | `/api/tasks` | List / create (`title` required; `scheduledDate` required when `status` is `scheduled`) |
| GET / PUT / DELETE | `/api/tasks/:id` | Read / partial update → `{ task, spawned }` / delete |
| POST | `/api/tasks/reorder` | `{ status, ids }`: set a column's order, moving tasks into it → `{ tasks, spawned }` |
| POST | `/api/tasks/activate-due` | Move scheduled tasks whose local date/time has arrived into Active |
| GET / PUT | `/api/settings` | `{ name, theme: 'light' \| 'dark' \| null, defaultView }` |
| GET / POST | `/api/people`, `/api/projects`, `/api/glossary`, `/api/notes` | List / create |
| GET / PUT / DELETE | `/api/{people,projects,glossary,notes}/:id` | Read / update / delete |
| GET / POST | `/api/export/markdown`, `/api/import/markdown` | TASKS.md (`{ markdown, mode: 'append' \| 'replace' }`) |
| GET / POST | `/api/export/json`, `/api/import/json` | Full backup / restore (accepts v1 and v2 backups) |

`spawned` lists the next occurrences created when a repeating task is completed. Every route except `/api/health` and `/api/auth/*` requires a session and only ever reads or writes the signed-in user's data.

## Project layout

```
shared/types.ts          Types shared by client and server
server/src/
  index.ts               Entry point (serves client/dist in production)
  app.ts                 Express app + error handling
  auth.ts                Passwords, sessions, cookies, rate limits, Google OAuth helpers
  db.ts                  Schema, migrations, per-user example data, guest → account moves
  localTime.ts           Browser-local "now" (X-Local-Now) + date arithmetic
  repo.ts                Row mapping, status rules, repeat logic, settings
  validation.ts          zod request schemas
  markdown.ts            TASKS.md parse / serialise
  routes/                auth, tasks, memory, settings, data (import/export)
server/tests/            API tests
client/src/
  App.tsx, main.tsx      Shell, shortcuts, error boundary, sign-in gate
  auth.tsx               Who's signed in; sign in / up / guest / reset / sign out
  welcome.css            Welcome screen + logo animations
  store.tsx              Data: optimistic updates, rollback, Undo, auto-activation
  theme.ts               Light/dark resolution + persistence
  markdown.tsx           Safe markdown renderer for notes
  confetti.ts            Dependency-free confetti burst
  components/            Welcome, Logo, Header, Greeting, FilterBar, TaskBoard, ListView, CalendarView,
                         TaskPanel, MemoryView/Panel, SettingsView, BottomBar, …
  styles.css             All styling (theme tokens, light + dark, responsive)
```
