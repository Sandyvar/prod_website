import { Router } from 'express';
import type { DB } from '../db.js';
import { uid } from '../auth.js';
import {
  assertOwned,
  bottomPosition,
  getTask,
  HttpError,
  listTasks,
  spawnNextOccurrence,
  statusTimestamps,
  toTask,
  topPosition,
} from '../repo.js';
import { taskCreate, taskReorder, taskUpdate } from '../validation.js';
import { parseId } from './util.js';
import type { Task, TaskMutation } from '../../../shared/types.js';

const COLUMN: Record<string, string> = {
  title: 'title',
  notes: 'notes',
  forPerson: 'for_person',
  dueDate: 'due_date',
  scheduledDate: 'scheduled_date',
  scheduledTime: 'scheduled_time',
  repeat: 'repeat',
  priority: 'priority',
  status: 'status',
  personId: 'person_id',
  projectId: 'project_id',
};

const requireScheduleDate = (t: Pick<Task, 'status' | 'scheduledDate'>) => {
  if (t.status === 'scheduled' && !t.scheduledDate) throw new HttpError(400, 'scheduledDate: Scheduled tasks need a date');
};

export function tasksRouter(db: DB) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json(listTasks(db, uid(req)));
  });

  r.get('/:id', (req, res) => {
    res.json(getTask(db, uid(req), parseId(req.params.id)));
  });

  r.post('/', (req, res) => {
    const userId = uid(req);
    const input = taskCreate.parse(req.body);
    const status = input.status ?? 'active';
    requireScheduleDate({ status, scheduledDate: input.scheduledDate ?? null });
    assertOwned(db, userId, 'people', [input.personId]);
    assertOwned(db, userId, 'projects', [input.projectId]);
    const now = new Date().toISOString();
    const ts = statusTimestamps(null, status, now);
    const info = db
      .prepare(
        `INSERT INTO tasks (user_id, title, notes, for_person, due_date, scheduled_date, scheduled_time, repeat, priority, tags, status, position,
                            person_id, project_id, created_at, completed_at, waiting_since, updated_at)
         VALUES (@userId, @title, @notes, @forPerson, @dueDate, @scheduledDate, @scheduledTime, @repeat, @priority, @tags, @status, @position,
                 @personId, @projectId, @now, @completedAt, @waitingSince, @now)`,
      )
      .run({
        userId,
        title: input.title,
        notes: input.notes ?? '',
        forPerson: input.forPerson ?? '',
        dueDate: input.dueDate ?? null,
        scheduledDate: input.scheduledDate ?? null,
        scheduledTime: input.scheduledDate ? (input.scheduledTime ?? null) : null,
        repeat: input.repeat ?? 'none',
        priority: input.priority ?? 'medium',
        tags: JSON.stringify(input.tags ?? []),
        status,
        position: bottomPosition(db, userId, status),
        personId: input.personId ?? null,
        projectId: input.projectId ?? null,
        now,
        completedAt: ts.completed_at,
        waitingSince: ts.waiting_since,
      });
    res.status(201).json(getTask(db, userId, Number(info.lastInsertRowid)));
  });

  /** Moves the user's scheduled tasks whose date/time has arrived (in the browser's local time) into Active. */
  r.post('/activate-due', (req, res) => {
    const userId = uid(req);
    const { date, time } = req.localNow;
    const due = (
      db
        .prepare(
          `SELECT * FROM tasks WHERE user_id = @userId AND status = 'scheduled' AND scheduled_date IS NOT NULL
             AND (scheduled_date < @date OR (scheduled_date = @date AND (scheduled_time IS NULL OR scheduled_time <= @time)))
           ORDER BY scheduled_date, scheduled_time`,
        )
        .all({ userId, date, time }) as Record<string, unknown>[]
    ).map(toTask);
    const now = new Date().toISOString();
    const activated = db.transaction(() => {
      let pos = topPosition(db, userId, 'active') - due.length;
      return due.map((t) => {
        db.prepare(`UPDATE tasks SET status = 'active', position = ?, updated_at = ? WHERE id = ?`).run(++pos, now, t.id);
        return getTask(db, userId, t.id);
      });
    })();
    res.json(activated);
  });

  r.post('/reorder', (req, res) => {
    const userId = uid(req);
    const { status, ids } = taskReorder.parse(req.body);
    const now = new Date().toISOString();
    const update = db.prepare(
      `UPDATE tasks SET status = @status, position = @position, completed_at = @completed_at,
              waiting_since = @waiting_since, updated_at = CASE WHEN status = @status THEN updated_at ELSE @now END
       WHERE id = @id AND user_id = @userId`,
    );
    const result = db.transaction(() => {
      const spawned: Task[] = [];
      const tasks = ids.map((id, position) => {
        const prev = getTask(db, userId, id);
        requireScheduleDate({ status, scheduledDate: prev.scheduledDate });
        update.run({ id, userId, status, position, now, ...statusTimestamps(prev, status, now) });
        if (status === 'done' && prev.status !== 'done') {
          const s = spawnNextOccurrence(db, userId, getTask(db, userId, id), req.localNow);
          if (s) spawned.push(s);
        }
        return getTask(db, userId, id);
      });
      return { tasks, spawned };
    })();
    res.json(result);
  });

  r.put('/:id', (req, res) => {
    const userId = uid(req);
    const id = parseId(req.params.id);
    const patch = taskUpdate.parse(req.body);
    const prev = getTask(db, userId, id);
    requireScheduleDate({ ...prev, ...patch });
    if ('personId' in patch) assertOwned(db, userId, 'people', [patch.personId]);
    if ('projectId' in patch) assertOwned(db, userId, 'projects', [patch.projectId]);
    const now = new Date().toISOString();
    const fields: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(COLUMN)) {
      if (k in patch) fields[col] = (patch as Record<string, unknown>)[k];
    }
    if (patch.tags) fields.tags = JSON.stringify(patch.tags);
    if ('scheduledDate' in patch && !patch.scheduledDate) fields.scheduled_time = null;
    const completing = patch.status === 'done' && prev.status !== 'done';
    if (patch.status && patch.status !== prev.status) {
      Object.assign(fields, statusTimestamps(prev, patch.status, now));
      fields.position = completing ? topPosition(db, userId, 'done') : bottomPosition(db, userId, patch.status);
    }
    fields.updated_at = now;
    const result = db.transaction((): TaskMutation => {
      const sets = Object.keys(fields).map((c) => `${c} = @${c}`);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id AND user_id = @userId`).run({ ...fields, id, userId });
      const spawned = completing ? spawnNextOccurrence(db, userId, getTask(db, userId, id), req.localNow) : null;
      return { task: getTask(db, userId, id), spawned: spawned ? [spawned] : [] };
    })();
    res.json(result);
  });

  r.delete('/:id', (req, res) => {
    const userId = uid(req);
    const id = parseId(req.params.id);
    getTask(db, userId, id);
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, userId);
    res.status(204).end();
  });

  return r;
}
