import { Router } from 'express';
import type { ZodType } from 'zod';
import type { DB } from '../db.js';
import { uid } from '../auth.js';
import { getProject, HttpError, listProjects, setProjectPeople, toGlossary, toNote, toPerson } from '../repo.js';
import { glossaryCreate, glossaryUpdate, noteCreate, noteUpdate, personCreate, personUpdate, projectCreate, projectUpdate } from '../validation.js';
import { buildSet, parseId } from './util.js';

interface SimpleCrudConfig<T> {
  table: string;
  label: string;
  orderBy: string;
  toApi: (row: any) => T;
  create: ZodType<Record<string, unknown>, any, any>;
  update: ZodType<Record<string, unknown>, any, any>;
  defaults: Record<string, unknown>;
}

/** Generic per-user CRUD router for flat tables (people, glossary, notes). */
function simpleCrud<T>(db: DB, cfg: SimpleCrudConfig<T>) {
  const r = Router();
  const get = (userId: number, id: number) => {
    const row = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ? AND user_id = ?`).get(id, userId);
    if (!row) throw new HttpError(404, `${cfg.label} ${id} not found`);
    return cfg.toApi(row);
  };

  r.get('/', (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${cfg.table} WHERE user_id = ? ORDER BY ${cfg.orderBy}`).all(uid(req)).map(cfg.toApi));
  });

  r.get('/:id', (req, res) => {
    res.json(get(uid(req), parseId(req.params.id)));
  });

  r.post('/', (req, res) => {
    const userId = uid(req);
    const input = { ...cfg.defaults, ...cfg.create.parse(req.body) };
    const now = new Date().toISOString();
    const { params } = buildSet(input, now);
    params.created_at = now;
    params.user_id = userId;
    const cols = Object.keys(params);
    const info = db.prepare(`INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(params);
    res.status(201).json(get(userId, Number(info.lastInsertRowid)));
  });

  r.put('/:id', (req, res) => {
    const userId = uid(req);
    const id = parseId(req.params.id);
    get(userId, id);
    const { sql, params } = buildSet(cfg.update.parse(req.body), new Date().toISOString());
    db.prepare(`UPDATE ${cfg.table} SET ${sql} WHERE id = @id AND user_id = @uid`).run({ ...params, id, uid: userId });
    res.json(get(userId, id));
  });

  r.delete('/:id', (req, res) => {
    const userId = uid(req);
    const id = parseId(req.params.id);
    get(userId, id);
    db.prepare(`DELETE FROM ${cfg.table} WHERE id = ? AND user_id = ?`).run(id, userId);
    res.status(204).end();
  });

  return r;
}

export const peopleRouter = (db: DB) =>
  simpleCrud(db, {
    table: 'people',
    label: 'Person',
    orderBy: 'nickname COLLATE NOCASE',
    toApi: toPerson,
    create: personCreate,
    update: personUpdate,
    defaults: { fullName: '', role: '', company: '', email: '', notes: '' },
  });

export const glossaryRouter = (db: DB) =>
  simpleCrud(db, { table: 'glossary', label: 'Term', orderBy: 'term COLLATE NOCASE', toApi: toGlossary, create: glossaryCreate, update: glossaryUpdate, defaults: {} });

export const notesRouter = (db: DB) =>
  simpleCrud(db, { table: 'notes', label: 'Note', orderBy: 'updated_at DESC', toApi: toNote, create: noteCreate, update: noteUpdate, defaults: { body: '' } });

export function projectsRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json(listProjects(db, uid(req)));
  });

  r.get('/:id', (req, res) => {
    res.json(getProject(db, uid(req), parseId(req.params.id)));
  });

  r.post('/', (req, res) => {
    const userId = uid(req);
    const { personIds, ...input } = projectCreate.parse(req.body);
    const now = new Date().toISOString();
    const id = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO projects (user_id, name, status, description, created_at, updated_at) VALUES (@userId, @name, @status, @description, @now, @now)`)
        .run({ userId, name: input.name, status: input.status ?? 'active', description: input.description ?? '', now });
      const pid = Number(info.lastInsertRowid);
      setProjectPeople(db, userId, pid, personIds ?? []);
      return pid;
    })();
    res.status(201).json(getProject(db, userId, id));
  });

  r.put('/:id', (req, res) => {
    const userId = uid(req);
    const id = parseId(req.params.id);
    getProject(db, userId, id);
    const { personIds, ...patch } = projectUpdate.parse(req.body);
    db.transaction(() => {
      const { sql, params } = buildSet(patch, new Date().toISOString());
      db.prepare(`UPDATE projects SET ${sql} WHERE id = @id AND user_id = @uid`).run({ ...params, id, uid: userId });
      if (personIds) setProjectPeople(db, userId, id, personIds);
    })();
    res.json(getProject(db, userId, id));
  });

  r.delete('/:id', (req, res) => {
    const userId = uid(req);
    const id = parseId(req.params.id);
    getProject(db, userId, id);
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
    res.status(204).end();
  });

  return r;
}
