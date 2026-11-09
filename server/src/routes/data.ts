import { Router } from 'express';
import type { DB } from '../db.js';
import { uid } from '../auth.js';
import { getSettings, listProjects, listTasks, toGlossary, toNote, toPerson, updateSettings } from '../repo.js';
import { markdownToTasks, tasksToMarkdown } from '../markdown.js';
import { backupSchema, markdownImport } from '../validation.js';
import type { Backup } from '../../../shared/types.js';

export function dataRouter(db: DB) {
  const r = Router();

  r.get('/export/markdown', (req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="TASKS.md"');
    res.send(tasksToMarkdown(listTasks(db, uid(req))));
  });

  r.post('/import/markdown', (req, res) => {
    const userId = uid(req);
    const { markdown, mode } = markdownImport.parse(req.body);
    const parsed = markdownToTasks(markdown);
    const now = new Date().toISOString();
    db.transaction(() => {
      if (mode === 'replace') db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
      const positions: Record<string, number> = {};
      for (const s of ['active', 'scheduled', 'waiting', 'done']) {
        const row = db.prepare('SELECT MAX(position) AS m FROM tasks WHERE user_id = ? AND status = ?').get(userId, s) as { m: number | null };
        positions[s] = row.m === null ? 0 : row.m + 1;
      }
      const ins = db.prepare(
        `INSERT INTO tasks (user_id, title, notes, for_person, due_date, scheduled_date, scheduled_time, repeat, priority, tags, status, position,
                            created_at, completed_at, waiting_since, updated_at)
         VALUES (@userId, @title, @notes, @forPerson, @dueDate, @scheduledDate, @scheduledTime, @repeat, 'medium', '[]', @status, @position,
                 @now, @completedAt, @waitingSince, @now)`,
      );
      for (const t of parsed) ins.run({ ...t, userId, position: positions[t.status]++, now, waitingSince: t.status === 'waiting' ? now : null });
    })();
    res.json({ imported: parsed.length, tasks: listTasks(db, userId) });
  });

  r.get('/export/json', (req, res) => {
    const userId = uid(req);
    const backup: Backup = {
      app: 'productivity',
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: getSettings(db, userId),
      tasks: listTasks(db, userId),
      people: db.prepare('SELECT * FROM people WHERE user_id = ? ORDER BY id').all(userId).map(toPerson),
      projects: listProjects(db, userId),
      glossary: db.prepare('SELECT * FROM glossary WHERE user_id = ? ORDER BY id').all(userId).map(toGlossary),
      notes: db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY id').all(userId).map(toNote),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="productivity-backup-${stamp}.json"`);
    res.json(backup);
  });

  /**
   * Replaces ALL of the signed-in user's data with the backup. Rows get new ids (ids are shared
   * across users), and links between tasks, people and projects are remapped to match.
   */
  r.post('/import/json', (req, res) => {
    const userId = uid(req);
    const b = backupSchema.parse(req.body);
    db.transaction(() => {
      for (const t of ['tasks', 'projects', 'people', 'glossary', 'notes']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
      const personMap = new Map<number, number>();
      const projectMap = new Map<number, number>();
      const insPerson = db.prepare(
        `INSERT INTO people (user_id, nickname, full_name, role, company, email, notes, created_at, updated_at)
         VALUES (@userId, @nickname, @fullName, @role, @company, @email, @notes, @createdAt, @updatedAt)`,
      );
      for (const p of b.people) personMap.set(p.id, Number(insPerson.run({ ...p, userId, updatedAt: p.updatedAt ?? p.createdAt }).lastInsertRowid));
      const insProject = db.prepare(
        `INSERT INTO projects (user_id, name, status, description, created_at, updated_at) VALUES (@userId, @name, @status, @description, @createdAt, @updatedAt)`,
      );
      const insLink = db.prepare('INSERT OR IGNORE INTO project_people (project_id, person_id) VALUES (?, ?)');
      for (const p of b.projects) {
        const newId = Number(
          insProject.run({ userId, name: p.name, status: p.status, description: p.description, createdAt: p.createdAt, updatedAt: p.updatedAt ?? p.createdAt })
            .lastInsertRowid,
        );
        projectMap.set(p.id, newId);
        for (const pid of p.personIds) if (personMap.has(pid)) insLink.run(newId, personMap.get(pid));
      }
      const insTask = db.prepare(
        `INSERT INTO tasks (user_id, title, notes, for_person, due_date, scheduled_date, scheduled_time, repeat, priority, tags, status, position,
                            person_id, project_id, created_at, completed_at, waiting_since, updated_at)
         VALUES (@userId, @title, @notes, @forPerson, @dueDate, @scheduledDate, @scheduledTime, @repeat, @priority, @tags, @status, @position,
                 @personId, @projectId, @createdAt, @completedAt, @waitingSince, @updatedAt)`,
      );
      for (const t of b.tasks) {
        insTask.run({
          ...t,
          userId,
          status: t.status === 'scheduled' && !t.scheduledDate ? 'active' : t.status,
          tags: JSON.stringify(t.tags),
          personId: t.personId !== null ? (personMap.get(t.personId) ?? null) : null,
          projectId: t.projectId !== null ? (projectMap.get(t.projectId) ?? null) : null,
          updatedAt: t.updatedAt ?? t.createdAt,
        });
      }
      const insTerm = db.prepare(`INSERT INTO glossary (user_id, term, meaning, created_at, updated_at) VALUES (@userId, @term, @meaning, @createdAt, @updatedAt)`);
      for (const g of b.glossary) insTerm.run({ ...g, userId, updatedAt: g.updatedAt ?? g.createdAt });
      const insNote = db.prepare(`INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (@userId, @title, @body, @createdAt, @updatedAt)`);
      for (const n of b.notes) insNote.run({ ...n, userId, updatedAt: n.updatedAt ?? n.createdAt });
      if (b.settings) {
        const { name, ...rest } = b.settings;
        updateSettings(db, userId, name ? b.settings : rest);
      }
    })();
    res.json({
      restored: { tasks: b.tasks.length, people: b.people.length, projects: b.projects.length, glossary: b.glossary.length, notes: b.notes.length },
    });
  });

  return r;
}
