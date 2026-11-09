import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB } from '../src/db.js';
import { createApp } from '../src/app.js';
import { markdownToTasks, tasksToMarkdown } from '../src/markdown.js';
import { addToDate, parseLocalNow } from '../src/localTime.js';
import { nextOccurrence } from '../src/repo.js';
import type { Task } from '../../shared/types.js';

let db: DB;
let app: ReturnType<typeof createApp>;
let a: ReturnType<typeof request.agent>; // a signed-in browser (guest) with its session cookie

async function guestAgent(target = app, name = 'Tester') {
  const agent = request.agent(target);
  await agent.post('/api/auth/guest').send({ name }).expect(201);
  return agent;
}

beforeEach(async () => {
  db = openDb(':memory:');
  app = createApp(db, { seedNewUsers: false });
  a = await guestAgent();
});

const NOW = '2026-11-10T09:30'; // the browser's local time used by most tests
const put = (url: string, body: object) => a.put(url).set('X-Local-Now', NOW).send(body);

describe('seeding', () => {
  it('gives each new user 6 example tasks (2 scheduled)', async () => {
    const seededApp = createApp(openDb(':memory:'));
    const g = await guestAgent(seededApp);
    const tasks = (await g.get('/api/tasks')).body as Task[];
    expect(tasks).toHaveLength(6);
    const scheduled = tasks.filter((t) => t.status === 'scheduled');
    expect(scheduled).toHaveLength(2);
    expect(scheduled.every((t) => t.scheduledDate)).toBe(true);
    expect(new Set(tasks.map((t) => t.status))).toEqual(new Set(['active', 'scheduled', 'waiting', 'done']));
    const second = await guestAgent(seededApp, 'Other');
    expect((await second.get('/api/tasks')).body).toHaveLength(6); // their own copy
  });

  it('migrates a database from the first version of the app', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prod-')), 'old.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      for_person TEXT NOT NULL DEFAULT '', due_date TEXT, priority TEXT NOT NULL DEFAULT 'med', tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active', position INTEGER NOT NULL DEFAULT 0, person_id INTEGER, project_id INTEGER,
      created_at TEXT NOT NULL, completed_at TEXT, waiting_since TEXT, updated_at TEXT NOT NULL);
      INSERT INTO tasks (title, priority, status, created_at, updated_at) VALUES ('old', 'med', 'someday', 'x', 'x');`);
    old.close();
    const migrated = openDb(file);
    const row = migrated.prepare('SELECT * FROM tasks').get() as Record<string, unknown>;
    expect(row).toMatchObject({ priority: 'medium', status: 'active', repeat: 'none', scheduled_date: null, user_id: null });
    // The first user to arrive claims the data from before accounts existed (and isn't seeded on top of it)
    const g = await guestAgent(createApp(migrated));
    const tasks = (await g.get('/api/tasks')).body as Task[];
    expect(tasks.map((t) => t.title)).toEqual(['old']);
  });
});

describe('tasks API', () => {
  it('creates a task with defaults', async () => {
    const res = await a.post('/api/tasks').send({ title: '  Write report  ' }).expect(201);
    expect(res.body).toMatchObject({ title: 'Write report', status: 'active', priority: 'medium', tags: [], repeat: 'none', scheduledDate: null });
  });

  it('rejects invalid input', async () => {
    await a.post('/api/tasks').send({}).expect(400);
    await a.post('/api/tasks').send({ title: '' }).expect(400);
    const bad = await a.post('/api/tasks').send({ title: 'x', priority: 'urgent', dueDate: '2026-02-30' }).expect(400);
    expect(bad.body.error).toMatch(/priority/);
    expect(bad.body.error).toMatch(/dueDate/);
    await a.post('/api/tasks').send({ title: 'x', scheduledDate: '2026-11-11', scheduledTime: '25:00' }).expect(400);
    await a.post('/api/tasks').send({ title: 'x', repeat: 'yearly' }).expect(400);
    await a.post('/api/tasks').send({ title: 'x', personId: 999 }).expect(400);
    await a.put('/api/tasks/1').send({ title: 'x' }).expect(404);
    await a.put('/api/tasks/abc').send({ title: 'x' }).expect(400);
    await a.post('/api/tasks').set('Content-Type', 'application/json').send('{bad json').expect(400);
  });

  it('requires a date for scheduled tasks', async () => {
    const res = await a.post('/api/tasks').send({ title: 'x', status: 'scheduled' }).expect(400);
    expect(res.body.error).toMatch(/need a date/);
    const { body: t } = await a
      .post('/api/tasks')
      .send({ title: 'x', status: 'scheduled', scheduledDate: '2026-11-13', scheduledTime: '10:00' })
      .expect(201);
    expect(t).toMatchObject({ status: 'scheduled', scheduledDate: '2026-11-13', scheduledTime: '10:00' });
    await put(`/api/tasks/${t.id}`, { scheduledDate: null }).expect(400);
    const { body: plain } = await a.post('/api/tasks').send({ title: 'a' });
    await put(`/api/tasks/${plain.id}`, { status: 'scheduled' }).expect(400);
    await a.post('/api/tasks/reorder').send({ status: 'scheduled', ids: [plain.id] }).expect(400);
  });

  it('updates fields and normalises tags', async () => {
    const { body: t } = await a.post('/api/tasks').send({ title: 'A' });
    const res = await put(`/api/tasks/${t.id}`, { notes: 'n', dueDate: '2026-12-01', tags: ['Work', 'work', 'Q4'], priority: 'high' }).expect(200);
    expect(res.body.task).toMatchObject({ notes: 'n', dueDate: '2026-12-01', tags: ['work', 'q4'], priority: 'high' });
    expect(res.body.spawned).toEqual([]);
  });

  it('stamps completedAt / waitingSince on status changes', async () => {
    const { body: t } = await a.post('/api/tasks').send({ title: 'A' });
    const done = await put(`/api/tasks/${t.id}`, { status: 'done' });
    expect(done.body.task.completedAt).toBeTruthy();
    const waiting = await put(`/api/tasks/${t.id}`, { status: 'waiting' });
    expect(waiting.body.task.completedAt).toBeNull();
    expect(waiting.body.task.waitingSince).toBeTruthy();
    const active = await put(`/api/tasks/${t.id}`, { status: 'active' });
    expect(active.body.task.waitingSince).toBeNull();
  });

  it('adds new tasks to the bottom of their column', async () => {
    await a.post('/api/tasks').send({ title: 'first' });
    await a.post('/api/tasks').send({ title: 'second' });
    const list = (await a.get('/api/tasks')).body as Task[];
    expect(list.map((t) => t.title)).toEqual(['first', 'second']);
  });

  it('reorders and moves tasks between columns', async () => {
    const ta = (await a.post('/api/tasks').send({ title: 'a' })).body;
    const b = (await a.post('/api/tasks').send({ title: 'b' })).body;
    const c = (await a.post('/api/tasks').send({ title: 'c', status: 'waiting' })).body;
    const res = await a.post('/api/tasks/reorder').send({ status: 'waiting', ids: [ta.id, c.id] }).expect(200);
    expect(res.body.tasks.map((t: Task) => [t.title, t.status, t.position])).toEqual([
      ['a', 'waiting', 0],
      ['c', 'waiting', 1],
    ]);
    expect(res.body.tasks[1].waitingSince).toBe(c.waitingSince);
    await a.post('/api/tasks/reorder').send({ status: 'done', ids: [b.id, 9999] }).expect(404);
    expect((await a.get(`/api/tasks/${b.id}`)).body.status).toBe('active'); // rolled back
  });

  it('deletes a task', async () => {
    const { body: t } = await a.post('/api/tasks').send({ title: 'A' });
    await a.delete(`/api/tasks/${t.id}`).expect(204);
    await a.get(`/api/tasks/${t.id}`).expect(404);
  });
});

describe('scheduling', () => {
  it('activates scheduled tasks whose local date/time has arrived', async () => {
    const mk = (title: string, scheduledDate: string, scheduledTime?: string) =>
      a.post('/api/tasks').send({ title, status: 'scheduled', scheduledDate, scheduledTime });
    await mk('yesterday', '2026-11-09');
    await mk('today no time', '2026-11-10');
    await mk('today 09:00', '2026-11-10', '09:00');
    await mk('today 10:00', '2026-11-10', '10:00');
    await mk('tomorrow', '2026-11-11');
    const res = await a.post('/api/tasks/activate-due').set('X-Local-Now', NOW).expect(200);
    expect(res.body.map((t: Task) => t.title).sort()).toEqual(['today 09:00', 'today no time', 'yesterday']);
    expect(res.body.every((t: Task) => t.status === 'active')).toBe(true);
    // Uses the browser's clock: at 10:00 local the next one activates.
    const later = await a.post('/api/tasks/activate-due').set('X-Local-Now', '2026-11-10T10:00').expect(200);
    expect(later.body.map((t: Task) => t.title)).toEqual(['today 10:00']);
  });

  it('creates the next occurrence when a repeating task is completed', async () => {
    const { body: t } = await a
      .post('/api/tasks')
      .send({ title: 'Standup', status: 'scheduled', scheduledDate: '2026-11-10', scheduledTime: '09:00', repeat: 'weekly', tags: ['team'] });
    const res = await put(`/api/tasks/${t.id}`, { status: 'done' }).expect(200);
    expect(res.body.task).toMatchObject({ status: 'done', repeat: 'none' });
    expect(res.body.spawned).toHaveLength(1);
    expect(res.body.spawned[0]).toMatchObject({
      title: 'Standup',
      status: 'scheduled',
      scheduledDate: '2026-11-17',
      scheduledTime: '09:00',
      repeat: 'weekly',
      tags: ['team'],
    });
    // Completing via drag (reorder) spawns too
    const { body: d } = await a.post('/api/tasks').send({ title: 'Daily', repeat: 'daily', scheduledDate: '2026-11-01' });
    const re = await a.post('/api/tasks/reorder').set('X-Local-Now', NOW).send({ status: 'done', ids: [d.id] }).expect(200);
    expect(re.body.spawned[0].scheduledDate).toBe('2026-11-11'); // skips past dates
  });

  it('computes next occurrences', () => {
    const local = { date: '2026-11-10', time: '12:00' };
    expect(nextOccurrence({ repeat: 'monthly', scheduledDate: '2026-01-31', dueDate: null }, { date: '2026-01-31', time: '12:00' })).toBe('2026-02-28');
    expect(nextOccurrence({ repeat: 'daily', scheduledDate: null, dueDate: null }, local)).toBe('2026-11-11');
    expect(nextOccurrence({ repeat: 'none', scheduledDate: '2026-11-10', dueDate: null }, local)).toBeNull();
    expect(addToDate('2026-12-31', 'day')).toBe('2027-01-01');
    expect(parseLocalNow('2026-02-30T10:00')).toBeNull();
    expect(parseLocalNow('2026-11-10T24:00')).toBeNull();
    expect(parseLocalNow('2026-11-10T23:59')).toEqual({ date: '2026-11-10', time: '23:59' });
  });
});

describe('settings API', () => {
  it('returns defaults and saves changes', async () => {
    expect((await a.get('/api/settings')).body).toEqual({ name: 'Tester', theme: null, defaultView: 'board' });
    const res = await a.put('/api/settings').send({ name: ' Sandy ', theme: 'dark', defaultView: 'calendar' }).expect(200);
    expect(res.body).toEqual({ name: 'Sandy', theme: 'dark', defaultView: 'calendar' });
    await a.put('/api/settings').send({ theme: 'blue' }).expect(400);
    expect((await a.put('/api/settings').send({ theme: null })).body.theme).toBeNull();
  });
});

describe('memory API', () => {
  it('CRUDs people and validates email', async () => {
    await a.post('/api/people').send({ nickname: 'Bo', email: 'not-an-email' }).expect(400);
    const { body: p } = await a.post('/api/people').send({ nickname: 'Bo', fullName: 'Bo Li', email: 'bo@x.com' }).expect(201);
    expect(p).toMatchObject({ nickname: 'Bo', fullName: 'Bo Li', role: '', email: 'bo@x.com' });
    expect((await a.put(`/api/people/${p.id}`).send({ role: 'CFO' }).expect(200)).body.role).toBe('CFO');
    await a.delete(`/api/people/${p.id}`).expect(204);
    await a.delete(`/api/people/${p.id}`).expect(404);
  });

  it('links tasks to people and unlinks when the person is deleted', async () => {
    const { body: p } = await a.post('/api/people').send({ nickname: 'Bo' });
    const { body: t } = await a.post('/api/tasks').send({ title: 'Call Bo', personId: p.id }).expect(201);
    expect(t.personId).toBe(p.id);
    await a.delete(`/api/people/${p.id}`).expect(204);
    expect((await a.get(`/api/tasks/${t.id}`)).body.personId).toBeNull();
  });

  it('CRUDs projects with related people', async () => {
    const { body: p1 } = await a.post('/api/people').send({ nickname: 'A' });
    const { body: p2 } = await a.post('/api/people').send({ nickname: 'B' });
    const { body: proj } = await a.post('/api/projects').send({ name: 'Launch', personIds: [p1.id, p2.id] }).expect(201);
    expect(proj).toMatchObject({ name: 'Launch', status: 'active', personIds: [p1.id, p2.id] });
    const upd = await a.put(`/api/projects/${proj.id}`).send({ status: 'on hold', personIds: [p2.id] }).expect(200);
    expect(upd.body).toMatchObject({ status: 'on hold', personIds: [p2.id] });
    await a.put(`/api/projects/${proj.id}`).send({ status: 'nope' }).expect(400);
    await a.put(`/api/projects/${proj.id}`).send({ personIds: [999] }).expect(400);
    await a.delete(`/api/projects/${proj.id}`).expect(204);
  });

  it('CRUDs glossary terms and notes', async () => {
    await a.post('/api/glossary').send({ term: 'EPBCS' }).expect(400);
    const { body: g } = await a.post('/api/glossary').send({ term: 'EPBCS', meaning: 'Enterprise Planning and Budgeting Cloud Service' }).expect(201);
    expect((await a.put(`/api/glossary/${g.id}`).send({ meaning: 'x' })).body.meaning).toBe('x');
    const { body: n } = await a.post('/api/notes').send({ title: 'Idea', body: '# text' }).expect(201);
    expect(n.body).toBe('# text');
    await a.delete(`/api/notes/${n.id}`).expect(204);
  });
});

describe('TASKS.md import / export', () => {
  const md = `# Tasks

## Active
- [ ] **Send budget** - Q4 numbers, for Sam, due 2026-12-01
- [ ] **Plain task**

## Scheduled
- [ ] **Team sync** - scheduled 2026-11-13 10:00, repeats weekly
- [ ] **Dentist** - scheduled 2026-11-20

## Waiting On
- [ ] **Legal review** - for Legal team

## Done
- [x] ~~Shipped v1~~ (2026-11-01)
`;

  it('parses the markdown format', () => {
    const tasks = markdownToTasks(md);
    expect(tasks).toHaveLength(6);
    expect(tasks[0]).toMatchObject({ title: 'Send budget', notes: 'Q4 numbers', forPerson: 'Sam', dueDate: '2026-12-01', status: 'active' });
    expect(tasks[2]).toMatchObject({ title: 'Team sync', status: 'scheduled', scheduledDate: '2026-11-13', scheduledTime: '10:00', repeat: 'weekly' });
    expect(tasks[3]).toMatchObject({ title: 'Dentist', status: 'scheduled', scheduledDate: '2026-11-20', scheduledTime: null });
    expect(tasks[4]).toMatchObject({ title: 'Legal review', forPerson: 'Legal team', status: 'waiting' });
    expect(tasks[5].status).toBe('done');
    expect(markdownToTasks('## Scheduled\n- [ ] **No date**')[0].status).toBe('active');
  });

  it('round-trips through the API', async () => {
    expect((await a.post('/api/import/markdown').send({ markdown: md }).expect(200)).body.imported).toBe(6);
    const exp = await a.get('/api/export/markdown').expect(200);
    expect(exp.headers['content-type']).toMatch(/markdown/);
    expect(exp.text).toContain('- [ ] **Send budget** - Q4 numbers, for Sam, due 2026-12-01');
    expect(exp.text).toContain('- [ ] **Team sync** - scheduled 2026-11-13 10:00, repeats weekly');
    expect(exp.text).toContain('- [x] ~~Shipped v1~~ (2026-11-01)');
    const strip = (ts: ReturnType<typeof markdownToTasks>) => ts.map(({ completedAt, ...t }) => ({ ...t, completedOn: completedAt?.slice(0, 10) ?? null }));
    expect(strip(markdownToTasks(exp.text))).toEqual(strip(markdownToTasks(md)));
  });

  it('replace mode clears existing tasks', async () => {
    await a.post('/api/tasks').send({ title: 'old' });
    await a.post('/api/import/markdown').send({ markdown: md, mode: 'replace' }).expect(200);
    const list = (await a.get('/api/tasks')).body as Task[];
    expect(list.find((t) => t.title === 'old')).toBeUndefined();
    expect(list).toHaveLength(6);
  });

  it('exports empty columns in order', () => {
    expect(tasksToMarkdown([])).toBe('# Tasks\n\n## Active\n\n## Scheduled\n\n## Waiting On\n\n## Done\n');
  });
});

describe('JSON backup / restore', () => {
  it('exports and restores everything with links and settings intact', async () => {
    const { body: p } = await a.post('/api/people').send({ nickname: 'Bo' });
    const { body: proj } = await a.post('/api/projects').send({ name: 'P', personIds: [p.id] });
    await a.post('/api/tasks').send({ title: 'T', personId: p.id, projectId: proj.id, tags: ['x'], status: 'scheduled', scheduledDate: '2026-12-01', repeat: 'monthly' });
    await a.post('/api/glossary').send({ term: 'A', meaning: 'B' });
    await a.post('/api/notes').send({ title: 'N' });
    await a.put('/api/settings').send({ name: 'Sandy', theme: 'dark' });
    const backup = (await a.get('/api/export/json').expect(200)).body;
    expect(backup).toMatchObject({ app: 'productivity', version: 2, settings: { name: 'Sandy', theme: 'dark' } });

    const fresh = await guestAgent(createApp(openDb(':memory:'), { seedNewUsers: false }), 'Someone');
    await fresh.post('/api/tasks').send({ title: 'will be replaced' });
    const res = await fresh.post('/api/import/json').send(backup).expect(200);
    expect(res.body.restored).toEqual({ tasks: 1, people: 1, projects: 1, glossary: 1, notes: 1 });
    const again = (await fresh.get('/api/export/json')).body;
    // Ids are reassigned on restore, but every link must still point at the right record.
    const t = again.tasks[0];
    expect(again.people.find((p: { id: number }) => p.id === t.personId).nickname).toBe('Bo');
    expect(again.projects.find((p: { id: number }) => p.id === t.projectId)).toMatchObject({ name: 'P', personIds: [again.people[0].id] });
    const strip = (b: Record<string, any>) =>
      JSON.parse(JSON.stringify({ ...b, exportedAt: null }, (k, v) => (['id', 'personId', 'projectId', 'personIds'].includes(k) ? undefined : v)));
    expect(strip(again)).toEqual(strip(backup));
  });

  it('restores a v1 backup (someday → active, med → medium)', async () => {
    const v1 = {
      app: 'productivity',
      version: 1,
      tasks: [
        { id: 1, title: 'Old', notes: '', forPerson: '', dueDate: null, priority: 'med', tags: [], status: 'someday', position: 0, personId: null, projectId: null, createdAt: 'x', completedAt: null, waitingSince: null },
      ],
      people: [],
      projects: [],
      glossary: [],
      notes: [],
    };
    await a.post('/api/import/json').send(v1).expect(200);
    expect((await a.get('/api/tasks/1')).body).toMatchObject({ status: 'active', priority: 'medium', repeat: 'none' });
  });

  it('rejects an invalid backup without touching data', async () => {
    await a.post('/api/tasks').send({ title: 'keep me' });
    await a.post('/api/import/json').send({ version: 3 }).expect(400);
    expect((await a.get('/api/tasks')).body).toHaveLength(1);
  });
});

describe('auth', () => {
  const signup = (agent: ReturnType<typeof request.agent>, email = 'sandy@example.com') =>
    agent.post('/api/auth/signup').send({ name: 'Sandy', email, password: 'correct horse' });

  it('requires a session for data routes', async () => {
    await request(app).get('/api/tasks').expect(401);
    expect((await request(app).get('/api/auth/me').expect(200)).body).toEqual({ user: null });
    expect((await request(app).get('/api/auth/config')).body).toEqual({ google: false });
  });

  it('signs up, stores a bcrypt hash and sets an httpOnly session cookie', async () => {
    const agent = request.agent(app);
    const res = await signup(agent).expect(201);
    expect(res.body.user).toMatchObject({ name: 'Sandy', email: 'sandy@example.com', isGuest: false, hasPassword: true });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/sid=[\w-]{20,}/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('sandy@example.com') as { password_hash: string };
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain('correct horse');
    // Only a hash of the session token is stored
    const token = cookie.match(/sid=([^;]+)/)![1];
    expect(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(token)).toBeUndefined();
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('sandy@example.com');
  });

  it('validates sign-up and rejects duplicate emails', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').send({ name: 'X', email: 'nope', password: 'longenough' }).expect(400);
    const short = await agent.post('/api/auth/signup').send({ name: 'X', email: 'x@y.com', password: 'short' }).expect(400);
    expect(short.body.error).toMatch(/at least 8/);
    await signup(agent).expect(201);
    const dup = await signup(request.agent(app)).expect(409);
    expect(dup.body.error).toMatch(/already exists/);
    await signup(request.agent(app), 'SANDY@example.com').expect(409); // case-insensitive
  });

  it('logs in and out', async () => {
    await signup(request.agent(app));
    const agent = request.agent(app);
    const bad = await agent.post('/api/auth/login').send({ email: 'sandy@example.com', password: 'wrong password' }).expect(401);
    expect(bad.body.error).toBe('Email or password is incorrect');
    const unknown = await agent.post('/api/auth/login').send({ email: 'who@example.com', password: 'whatever1' }).expect(401);
    expect(unknown.body.error).toBe(bad.body.error); // no account enumeration
    await agent.post('/api/auth/login').send({ email: 'Sandy@Example.com', password: 'correct horse' }).expect(200);
    await agent.get('/api/tasks').expect(200);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/tasks').expect(401);
  });

  it('rate-limits repeated failed logins', async () => {
    const agent = request.agent(app);
    for (let i = 0; i < 10; i++) await agent.post('/api/auth/login').send({ email: 'x@example.com', password: 'wrongpass' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'x@example.com', password: 'wrongpass' }).expect(429);
  });

  it('keeps each user’s data separate', async () => {
    const alice = await guestAgent(app, 'Alice');
    const { body: t } = await alice.post('/api/tasks').send({ title: 'Alice secret' }).expect(201);
    const { body: p } = await alice.post('/api/people').send({ nickname: 'Carol' }).expect(201);
    expect((await a.get('/api/tasks')).body).toEqual([]);
    expect((await a.get('/api/people')).body).toEqual([]);
    await a.get(`/api/tasks/${t.id}`).expect(404);
    await a.put(`/api/tasks/${t.id}`).send({ title: 'hacked' }).expect(404);
    await a.delete(`/api/tasks/${t.id}`).expect(404);
    await a.delete(`/api/people/${p.id}`).expect(404);
    await a.post('/api/tasks/reorder').send({ status: 'done', ids: [t.id] }).expect(404);
    // Can't link to someone else's person or project either
    await a.post('/api/tasks').send({ title: 'x', personId: p.id }).expect(400);
    await a.post('/api/projects').send({ name: 'x', personIds: [p.id] }).expect(400);
    const md = (await a.get('/api/export/markdown')).text;
    expect(md).not.toContain('Alice secret');
    expect((await alice.get(`/api/tasks/${t.id}`)).body.title).toBe('Alice secret');
  });

  it('turns a guest into an account on sign-up, keeping their data', async () => {
    await a.post('/api/tasks').send({ title: 'made as guest' });
    const res = await signup(a).expect(201);
    expect(res.body).toMatchObject({ keptGuestData: true, user: { isGuest: false, name: 'Sandy' } });
    expect((await a.get('/api/tasks')).body.map((t: Task) => t.title)).toEqual(['made as guest']);
  });

  it('moves guest data into an existing account on sign-in', async () => {
    const owner = request.agent(app);
    await signup(owner);
    await owner.post('/api/tasks').send({ title: 'account task' });
    await owner.post('/api/auth/logout');
    await a.post('/api/tasks').send({ title: 'guest task' });
    const res = await a.post('/api/auth/login').send({ email: 'sandy@example.com', password: 'correct horse' }).expect(200);
    expect(res.body.keptGuestData).toBe(true);
    expect((await a.get('/api/tasks')).body.map((t: Task) => t.title).sort()).toEqual(['account task', 'guest task']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_guest = 1').get()).toEqual({ n: 0 });
  });

  it('does not duplicate untouched example data when a guest signs in to an account', async () => {
    const seededApp = createApp(openDb(':memory:'));
    const owner = request.agent(seededApp);
    await signup(owner).expect(201); // account gets the 6 examples
    await owner.post('/api/auth/logout');
    const g = await guestAgent(seededApp, 'Guest'); // guest gets their own 6 examples
    const gTasks = (await g.get('/api/tasks')).body as Task[];
    await g.put(`/api/tasks/${gTasks[0].id}`).send({ title: 'Example I edited' }).expect(200);
    await g.post('/api/tasks').send({ title: 'Mine' }).expect(201);
    await g.post('/api/auth/login').send({ email: 'sandy@example.com', password: 'correct horse' }).expect(200);
    const titles = ((await g.get('/api/tasks')).body as Task[]).map((t) => t.title);
    expect(titles).toHaveLength(6 + 2); // account examples + the edited example + the new task
    expect(titles).toContain('Example I edited');
    expect(titles).toContain('Mine');
    expect((await g.get('/api/people')).body).toHaveLength(1);
  });

  it('resets a password with a one-time link', async () => {
    await signup(request.agent(app));
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...m: unknown[]) => logs.push(m.join(' '));
    try {
      expect((await request(app).post('/api/auth/forgot').send({ email: 'sandy@example.com' }).expect(200)).body.delivery).toBe('console');
      await request(app).post('/api/auth/forgot').send({ email: 'nobody@example.com' }).expect(200); // same answer
    } finally {
      console.log = orig;
    }
    const token = logs.join('\n').match(/\?reset=([\w-]+)/)![1];
    const agent = request.agent(app);
    await agent.post('/api/auth/reset').send({ token, password: 'brand new pass' }).expect(200);
    await agent.get('/api/tasks').expect(200); // signed in
    await request(app).post('/api/auth/reset').send({ token, password: 'again again' }).expect(400); // single use
    await request(app).post('/api/auth/login').send({ email: 'sandy@example.com', password: 'correct horse' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'sandy@example.com', password: 'brand new pass' }).expect(200);
  });

  it('blocks cross-site writes', async () => {
    await a.post('/api/tasks').set('Origin', 'https://evil.example').send({ title: 'x' }).expect(403);
  });

  it('explains when Google sign-in is not configured', async () => {
    const res = await request(app).get('/api/auth/google').expect(302);
    expect(decodeURIComponent(res.headers.location)).toMatch(/GOOGLE_CLIENT_ID/);
  });
});
