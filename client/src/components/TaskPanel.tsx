import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { PRIORITIES, REPEATS, STATUSES, STATUS_LABELS, type Task } from '../../../shared/types';
import { useData, type TaskInput } from '../store';
import { daysSince, dayFromToday, dueState, formatDate, formatDay, PRIORITY_LABEL, waitingLabel } from '../utils';
import { useConfirm } from './Confirm';
import { Drawer } from './Drawer';
import { AutoInput, AutoTextarea, Field, Segmented, TagsInput } from './fields';
import { TaskCheckbox } from './TaskCard';
import { PriorityDot } from './ui';

export type PanelTarget = { id: number } | { draft: Partial<TaskInput> };

type FormTask = Pick<
  Task,
  'title' | 'notes' | 'forPerson' | 'dueDate' | 'scheduledDate' | 'scheduledTime' | 'repeat' | 'priority' | 'tags' | 'status' | 'personId' | 'projectId'
>;

const BLANK: FormTask = {
  title: '',
  notes: '',
  forPerson: '',
  dueDate: null,
  scheduledDate: null,
  scheduledTime: null,
  repeat: 'none',
  priority: 'medium',
  tags: [],
  status: 'active',
  personId: null,
  projectId: null,
};

export function TaskPanel({ target, onClose }: { target: PanelTarget; onClose: () => void }) {
  return 'id' in target ? <EditTask id={target.id} onClose={onClose} /> : <NewTask draft={target.draft} onClose={onClose} />;
}

function EditTask({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, updateTask, deleteTask } = useData();
  const confirm = useConfirm();
  const task = data.tasks.find((t) => t.id === id);

  useEffect(() => {
    if (!task) onClose();
  }, [task, onClose]);
  if (!task) return null;

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete task?',
      message: `“${task.title}” will be deleted. You can undo this from the notification.`,
      actions: [{ key: 'delete', label: 'Delete', variant: 'danger' }],
    });
    if (ok) {
      onClose();
      void deleteTask(task.id);
    }
  };

  return (
    <Drawer
      label="Edit task"
      onClose={onClose}
      title={
        <div className="panel-title-row">
          <TaskCheckbox task={task} />
          <span>{task.status === 'done' ? 'Completed task' : 'Edit task'}</span>
        </div>
      }
      footer={
        <>
          <div className="panel-dates">
            <span>Created {formatDate(task.createdAt, true)}</span>
            {task.completedAt && <span>Completed {formatDate(task.completedAt, true)}</span>}
            {task.status === 'waiting' && task.waitingSince && <span>{waitingLabel(daysSince(task.waitingSince))}</span>}
          </div>
          <button className="btn btn-ghost-danger" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
        </>
      }
    >
      <TaskForm task={task} live taskId={task.id} onPatch={(p) => void updateTask(task.id, p)} />
    </Drawer>
  );
}

function NewTask({ draft, onClose }: { draft: Partial<TaskInput>; onClose: () => void }) {
  const { createTask } = useData();
  const [form, setForm] = useState<FormTask>(() => ({ ...BLANK, ...draft }));
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const invalid = !form.title.trim() || (form.status === 'scheduled' && !form.scheduledDate);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (invalid || saving) return;
    setSaving(true);
    const saved = await createTask({ ...form, title: form.title.trim(), scheduledTime: form.scheduledDate ? form.scheduledTime : null });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Drawer
      label="New task"
      title="New task"
      onClose={onClose}
      footer={
        <>
          <span className="hint">⌘/Ctrl + Enter to create</span>
          <div className="footer-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form={formId} disabled={invalid || saving}>
              {saving ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
        }}
      >
        <TaskForm task={form} onPatch={(p) => setForm((f) => ({ ...f, ...p }))} autoFocus />
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

interface FormProps {
  task: FormTask;
  onPatch: (p: Partial<Task>) => void;
  /** Edit mode: text fields autosave after a pause. New mode: plain controlled fields. */
  live?: boolean;
  taskId?: number;
  autoFocus?: boolean;
}

function TaskForm({ task, onPatch, live, taskId, autoFocus }: FormProps) {
  const { data } = useData();
  const ids = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const allTags = useMemo(() => [...new Set(data.tasks.flatMap((t) => t.tags))].sort(), [data.tasks]);
  const due = dueState(task);
  const scheduled = task.status === 'scheduled';
  const [dateError, setDateError] = useState(false);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  const setStatus = (status: Task['status']) => {
    // Scheduled tasks need a date — default to tomorrow.
    onPatch(status === 'scheduled' && !task.scheduledDate ? { status, scheduledDate: dayFromToday(1) } : { status });
  };

  const setScheduledDate = (v: string) => {
    if (!v && scheduled) {
      setDateError(true);
      return;
    }
    setDateError(false);
    onPatch({ scheduledDate: v || null, ...(v ? {} : { scheduledTime: null }) });
  };

  const saveForPerson = (v: string) => {
    const patch: Partial<Task> = { forPerson: v };
    if (!task.personId && v.trim()) {
      const want = v.trim().toLowerCase();
      const match = data.people.find((p) => p.nickname.toLowerCase() === want || p.fullName.toLowerCase() === want);
      if (match) patch.personId = match.id;
    }
    onPatch(patch);
  };

  const k = (name: string) => `${name}-${taskId ?? 'new'}`;

  return (
    <div className="task-form">
      {live ? (
        <AutoInput key={k('title')} value={task.title} onSave={(v) => onPatch({ title: v.trim() })} required placeholder="Task title" className={`title-input ${task.status === 'done' ? 'struck' : ''}`} />
      ) : (
        <input
          ref={titleRef}
          className="input title-input"
          value={task.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="What needs doing?"
          aria-label="Task title"
          required
        />
      )}

      <Field label="Column">
        <Segmented label="Column" value={task.status} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} onChange={setStatus} />
      </Field>

      <fieldset className={`schedule-box ${scheduled ? 'is-scheduled' : ''}`}>
        <legend className="field-label">{scheduled ? 'Schedule' : 'Schedule (optional)'}</legend>
        <div className="schedule-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-sd`}>
              Date{scheduled && ' *'}
            </label>
            <input
              id={`${ids}-sd`}
              type="date"
              className={`input ${dateError ? 'invalid' : ''}`}
              value={task.scheduledDate ?? ''}
              required={scheduled}
              aria-invalid={dateError}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-st`}>
              Time
            </label>
            <input
              id={`${ids}-st`}
              type="time"
              className="input"
              value={task.scheduledTime ?? ''}
              disabled={!task.scheduledDate}
              onChange={(e) => onPatch({ scheduledTime: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-rp`}>
              Repeat
            </label>
            <select id={`${ids}-rp`} className="select" value={task.repeat} onChange={(e) => onPatch({ repeat: e.target.value as Task['repeat'] })}>
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {r === 'none' ? 'Never' : r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {dateError && <p className="field-error">Scheduled tasks need a date.</p>}
        {scheduled && <p className="field-help">Moves to Active automatically when the date{task.scheduledTime ? ' and time' : ''} arrives.</p>}
      </fieldset>

      <div className="field-grid">
        <Field label="Priority">
          <Segmented
            label="Priority"
            value={task.priority}
            options={PRIORITIES.map((p) => ({ value: p, label: <><PriorityDot priority={p} /> {PRIORITY_LABEL[p]}</> }))}
            onChange={(priority) => onPatch({ priority })}
          />
        </Field>
        <Field label="Due date" htmlFor={`${ids}-due`} hint={task.dueDate && <span className={`due-hint ${due ?? ''}`}>{due === 'overdue' ? 'Overdue' : formatDay(task.dueDate)}</span>}>
          <input id={`${ids}-due`} type="date" className={`input ${due ? `due-${due}` : ''}`} value={task.dueDate ?? ''} onChange={(e) => onPatch({ dueDate: e.target.value || null })} />
          <div className="quick-dates">
            <button type="button" onClick={() => onPatch({ dueDate: dayFromToday(0) })}>
              Today
            </button>
            <button type="button" onClick={() => onPatch({ dueDate: dayFromToday(1) })}>
              Tomorrow
            </button>
            <button type="button" onClick={() => onPatch({ dueDate: dayFromToday(7) })}>
              Next week
            </button>
            {task.dueDate && (
              <button type="button" onClick={() => onPatch({ dueDate: null })}>
                Clear
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="field-grid">
        {live ? (
          <AutoInput key={k('for')} label="For (person)" value={task.forPerson} onSave={saveForPerson} placeholder="Who is this for?" list={`${ids}-people`} />
        ) : (
          <Field label="For (person)" htmlFor={`${ids}-for`}>
            <input id={`${ids}-for`} className="input" list={`${ids}-people`} value={task.forPerson} placeholder="Who is this for?" onChange={(e) => onPatch({ forPerson: e.target.value })} onBlur={(e) => saveForPerson(e.target.value)} />
          </Field>
        )}
        <Field label="Linked person" htmlFor={`${ids}-lp`}>
          <select id={`${ids}-lp`} className="select" value={task.personId ?? ''} onChange={(e) => onPatch({ personId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— None —</option>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname}
                {p.fullName ? ` (${p.fullName})` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <datalist id={`${ids}-people`}>
        {data.people.map((p) => (
          <option key={p.id} value={p.nickname} />
        ))}
      </datalist>

      <Field label="Project" htmlFor={`${ids}-pr`}>
        <select id={`${ids}-pr`} className="select" value={task.projectId ?? ''} onChange={(e) => onPatch({ projectId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">— None —</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Tags">
        <TagsInput value={task.tags} onChange={(tags) => onPatch({ tags })} suggestions={allTags} />
      </Field>

      {live ? (
        <AutoTextarea key={k('notes')} label="Notes" value={task.notes} onSave={(v) => onPatch({ notes: v })} rows={5} placeholder="Context, links, next steps…" />
      ) : (
        <Field label="Notes" htmlFor={`${ids}-notes`}>
          <textarea id={`${ids}-notes`} className="input textarea" rows={4} value={task.notes} placeholder="Context, links, next steps…" onChange={(e) => onPatch({ notes: e.target.value })} />
        </Field>
      )}
    </div>
  );
}
