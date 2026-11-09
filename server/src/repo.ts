import type { DB } from './db.js';
import type { GlossaryTerm, Note, Person, Project, Settings, Status, Task } from '../../shared/types.js';
import { addToDate, type LocalNow } from './localTime.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Row = Record<string, any>;

export const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  forPerson: r.for_person,
  dueDate: r.due_date,
  scheduledDate: r.scheduled_date,
  scheduledTime: r.scheduled_time,
  repeat: r.repeat,
  priority: r.priority,
  tags: JSON.parse(r.tags),
  status: r.status,
  position: r.position,
  personId: r.person_id,
  projectId: r.project_id,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  waitingSince: r.waiting_since,
  updatedAt: r.updated_at,
});

export const toPerson = (r: any): Person => ({
  id: r.id,
  nickname: r.nickname,
  fullName: r.full_name,
  role: r.role,
  company: r.company,
  email: r.email,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toGlossary = (r: any): GlossaryTerm => ({
  id: r.id,
  term: r.term,
  meaning: r.meaning,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toNote = (r: any): Note => ({
  id: r.id,
  title: r.title,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Every lookup is scoped to the user: another user's id behaves exactly like a missing one.
export function getTask(db: DB, userId: number, id: number): Task {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new HttpError(404, `Task ${id} not found`);
  return toTask(row as Row);
}

export function listTasks(db: DB, userId: number): Task[] {
  return (db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY position ASC, id DESC').all(userId) as Row[]).map(toTask);
}

export function getProject(db: DB, userId: number, id: number): Project {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  if (!row) throw new HttpError(404, `Project ${id} not found`);
  return withPeople(db, row);
}

export function listProjects(db: DB, userId: number): Project[] {
  return (db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as Row[]).map((r) => withPeople(db, r));
}

function withPeople(db: DB, r: Row): Project {
  const personIds = (db.prepare('SELECT person_id FROM project_people WHERE project_id = ? ORDER BY person_id').all(r.id) as Row[]).map(
    (p) => p.person_id as number,
  );
  return { id: r.id, name: r.name, status: r.status, description: r.description, personIds, createdAt: r.created_at, updatedAt: r.updated_at };
}

/** Throws 400 unless every id exists in `table` and belongs to the user. */
export function assertOwned(db: DB, userId: number, table: 'people' | 'projects', ids: (number | null | undefined)[]) {
  for (const id of ids) {
    if (id == null) continue;
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId)) {
      throw new HttpError(400, table === 'people' ? 'Linked person does not exist' : 'Linked project does not exist');
    }
  }
}

export function setProjectPeople(db: DB, userId: number, projectId: number, personIds: number[]) {
  assertOwned(db, userId, 'people', personIds);
  db.prepare('DELETE FROM project_people WHERE project_id = ?').run(projectId);
  const ins = db.prepare('INSERT INTO project_people (project_id, person_id) VALUES (?, ?)');
  for (const pid of new Set(personIds)) ins.run(projectId, pid);
}

export function statusTimestamps(prev: Pick<Task, 'status' | 'completedAt' | 'waitingSince'> | null, next: Status, now: string) {
  return {
    completed_at: next === 'done' ? (prev?.status === 'done' ? prev.completedAt : now) : null,
    waiting_since: next === 'waiting' ? (prev?.status === 'waiting' ? prev.waitingSince : now) : null,
  };
}

export function topPosition(db: DB, userId: number, status: Status): number {
  const r = db.prepare('SELECT MIN(position) AS m FROM tasks WHERE user_id = ? AND status = ?').get(userId, status) as Row;
  return r.m === null ? 0 : r.m - 1;
}

export function bottomPosition(db: DB, userId: number, status: Status): number {
  const r = db.prepare('SELECT MAX(position) AS m FROM tasks WHERE user_id = ? AND status = ?').get(userId, status) as Row;
  return r.m === null ? 0 : r.m + 1;
}

/** Next occurrence date of a repeating task — always strictly after the user's today. */
export function nextOccurrence(task: Pick<Task, 'repeat' | 'scheduledDate' | 'dueDate'>, local: LocalNow): string | null {
  if (task.repeat === 'none') return null;
  const unit = task.repeat === 'daily' ? 'day' : task.repeat === 'weekly' ? 'week' : 'month';
  let d = addToDate(task.scheduledDate ?? task.dueDate ?? local.date, unit);
  for (let i = 0; d <= local.date && i < 5000; i++) d = addToDate(d, unit);
  return d;
}

/** When a repeating task is completed, create its next occurrence in Scheduled. */
export function spawnNextOccurrence(db: DB, userId: number, task: Task, local: LocalNow): Task | null {
  const next = nextOccurrence(task, local);
  if (!next) return null;
  let dueDate: string | null = null;
  if (task.dueDate) {
    const anchor = task.scheduledDate ?? task.dueDate;
    const shift = Math.round((Date.parse(next) - Date.parse(anchor)) / 86400000);
    dueDate = addToDate(task.dueDate, 'day', shift);
  }
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO tasks (user_id, title, notes, for_person, due_date, scheduled_date, scheduled_time, repeat, priority, tags, status, position,
                          person_id, project_id, created_at, updated_at)
       VALUES (@userId, @title, @notes, @forPerson, @dueDate, @scheduledDate, @scheduledTime, @repeat, @priority, @tags, 'scheduled', @position,
               @personId, @projectId, @now, @now)`,
    )
    .run({
      userId,
      title: task.title,
      notes: task.notes,
      forPerson: task.forPerson,
      dueDate,
      scheduledDate: next,
      scheduledTime: task.scheduledTime,
      repeat: task.repeat,
      priority: task.priority,
      tags: JSON.stringify(task.tags),
      position: bottomPosition(db, userId, 'scheduled'),
      personId: task.personId,
      projectId: task.projectId,
      now,
    });
  db.prepare(`UPDATE tasks SET repeat = 'none' WHERE id = ?`).run(task.id);
  return getTask(db, userId, Number(info.lastInsertRowid));
}

// ---- Settings (per user; `name` lives on the user record) ----
export const DEFAULT_SETTINGS: Settings = { name: '', theme: null, defaultView: 'board' };

export function getSettings(db: DB, userId: number): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId) as { key: string; value: string }[];
  for (const { key, value } of rows) if (key === 'theme' || key === 'defaultView') (out as unknown as Record<string, unknown>)[key] = JSON.parse(value);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string } | undefined;
  out.name = user?.name ?? '';
  return out;
}

export function updateSettings(db: DB, userId: number, patch: Partial<Settings>) {
  const up = db.prepare(
    'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === 'name') db.prepare('UPDATE users SET name = ? WHERE id = ?').run(v, userId);
      else up.run(userId, k, JSON.stringify(v));
    }
  })();
  return getSettings(db, userId);
}
