import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { addToDate, serverLocalNow } from './localTime.js';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Settings from before accounts existed (claimed by the first user).
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_people (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  for_person TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  scheduled_date TEXT,
  scheduled_time TEXT,
  repeat TEXT NOT NULL DEFAULT 'none',
  priority TEXT NOT NULL DEFAULT 'medium',
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  position INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  waiting_since TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Tables holding a user's own data. */
export const USER_TABLES = ['tasks', 'people', 'projects', 'glossary', 'notes'] as const;

export function openDb(file?: string): DB {
  const target = file ?? process.env.DB_PATH ?? path.resolve(process.cwd(), 'data/app.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Upgrades databases created by earlier versions of the app (before scheduling, before accounts). */
function migrate(db: DB) {
  const columns = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  const taskCols = columns('tasks');
  const add = (table: string, cols: Set<string>, name: string, def: string) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  };
  add('tasks', taskCols, 'scheduled_date', 'TEXT');
  add('tasks', taskCols, 'scheduled_time', 'TEXT');
  add('tasks', taskCols, 'repeat', `TEXT NOT NULL DEFAULT 'none'`);
  for (const t of USER_TABLES) {
    const cols = t === 'tasks' ? taskCols : columns(t);
    add(t, cols, 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');
    add(t, cols, 'example', 'INTEGER NOT NULL DEFAULT 0'); // 1 = created by the welcome seed
  }
  db.exec(`UPDATE tasks SET priority = 'medium' WHERE priority = 'med'`);
  db.exec(`UPDATE tasks SET status = 'active' WHERE status = 'someday'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, status, position)`);
  for (const t of ['people', 'projects', 'glossary', 'notes']) db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_user ON ${t}(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
}

/**
 * Data created before accounts existed has no owner. The first user to be created claims it,
 * so upgrading doesn't lose anything. Returns true if anything was claimed.
 */
export function claimOrphans(db: DB, userId: number): boolean {
  let claimed = 0;
  for (const t of USER_TABLES) claimed += db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(userId).changes;
  const legacy = db.prepare(`SELECT key, value FROM settings WHERE key IN ('theme', 'defaultView')`).all() as { key: string; value: string }[];
  for (const s of legacy) db.prepare(`INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`).run(userId, s.key, s.value);
  if (legacy.length) db.exec(`DELETE FROM settings`);
  return claimed > 0;
}

/**
 * Moves one user's data to another (used when a guest signs in to an existing account).
 * Example rows the guest never edited are dropped, so the account doesn't get a second copy
 * of the welcome examples; anything the guest created or changed comes across.
 */
export function moveUserData(db: DB, fromUserId: number, toUserId: number) {
  for (const t of USER_TABLES) db.prepare(`DELETE FROM ${t} WHERE user_id = ? AND example = 1 AND updated_at = created_at`).run(fromUserId);
  for (const t of USER_TABLES) db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(toUserId, fromUserId);
}

/** Example data every new user starts with: 6 tasks (2 scheduled), a person, a project, a term and a note. */
export function seedUser(db: DB, userId: number) {
  const now = new Date();
  const iso = now.toISOString();
  const today = serverLocalNow(now).date;
  const day = (n: number) => addToDate(today, 'day', n);
  const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

  db.transaction(() => {
    const markExamples = () => {
      for (const t of USER_TABLES) db.prepare(`UPDATE ${t} SET example = 1 WHERE user_id = ?`).run(userId);
    };
    const sam = db
      .prepare(
        `INSERT INTO people (user_id, nickname, full_name, role, company, email, notes, created_at, updated_at)
         VALUES (?, 'Sam', 'Sam Rivera', 'Finance Manager', 'Acme Corp', 'sam@example.com', 'Prefers Teams over email.', ?, ?)`,
      )
      .run(userId, iso, iso).lastInsertRowid;
    const project = db
      .prepare(
        `INSERT INTO projects (user_id, name, status, description, created_at, updated_at)
         VALUES (?, 'FY27 Planning', 'active', 'Annual budget and forecast cycle in EPBCS.', ?, ?)`,
      )
      .run(userId, iso, iso).lastInsertRowid;
    db.prepare('INSERT INTO project_people (project_id, person_id) VALUES (?, ?)').run(project, sam);
    db.prepare(
      `INSERT INTO glossary (user_id, term, meaning, created_at, updated_at) VALUES (?, 'EPBCS', 'Enterprise Planning and Budgeting Cloud Service', ?, ?)`,
    ).run(userId, iso, iso);
    db.prepare(`INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
      userId,
      'Welcome to Productivity',
      [
        '## Getting started',
        '',
        '- Press **N** to add a task, **/** to search, **D** to toggle dark mode',
        '- Drag cards between columns, or reschedule them in the **Calendar** view',
        '- Notes support *markdown* — `code`, lists, [links](https://example.com) and more',
      ].join('\n'),
      iso,
      iso,
    );

    const insert = db.prepare(
      `INSERT INTO tasks (user_id, title, notes, for_person, due_date, scheduled_date, scheduled_time, repeat, priority, tags, status, position,
                          person_id, project_id, created_at, completed_at, waiting_since, updated_at)
       VALUES (@userId, @title, @notes, @forPerson, @dueDate, @scheduledDate, @scheduledTime, @repeat, @priority, @tags, @status, @position,
               @personId, @projectId, @createdAt, @completedAt, @waitingSince, @createdAt)`,
    );
    const base = {
      userId,
      notes: '',
      forPerson: '',
      dueDate: null,
      scheduledDate: null,
      scheduledTime: null,
      repeat: 'none',
      priority: 'medium',
      tags: '[]',
      position: 0,
      personId: null,
      projectId: null,
      createdAt: iso,
      completedAt: null,
      waitingSince: null,
    };
    const tasks = [
      {
        title: 'Prepare Q4 budget review deck',
        notes: 'Pull actuals from EPBCS and compare against forecast',
        forPerson: 'Sam',
        dueDate: today,
        priority: 'high',
        tags: JSON.stringify(['finance', 'q4']),
        status: 'active',
        personId: sam,
        projectId: project,
      },
      {
        title: 'Send revised forecast to Sam',
        forPerson: 'Sam',
        dueDate: day(-1),
        tags: JSON.stringify(['finance']),
        status: 'active',
        position: 1,
        personId: sam,
        projectId: project,
      },
      {
        title: 'Weekly team sync',
        notes: 'Agenda: blockers, priorities, wins',
        scheduledDate: day(1),
        scheduledTime: '10:00',
        repeat: 'weekly',
        tags: JSON.stringify(['meetings']),
        status: 'scheduled',
      },
      {
        title: 'Quarterly close checklist review',
        scheduledDate: day(4),
        priority: 'low',
        status: 'scheduled',
        position: 1,
        projectId: project,
      },
      {
        title: 'Approval on vendor contract',
        notes: 'Sent to legal for review',
        forPerson: 'Legal team',
        tags: JSON.stringify(['contracts']),
        status: 'waiting',
        createdAt: ago(3),
        waitingSince: ago(3),
      },
      { title: 'Book offsite venue', status: 'done', projectId: project, createdAt: ago(5), completedAt: ago(1) },
    ];
    for (const t of tasks) insert.run({ ...base, ...t });
    markExamples();
  })();
}
