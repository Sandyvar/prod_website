import { useId, useState, type FormEvent } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { PROJECT_STATUSES, type Note, type Person, type Project, type Task } from '../../../shared/types';
import { useData, type MemoryKind } from '../store';
import { byPosition, dueState, formatDay } from '../utils';
import { Markdown } from '../markdown';
import { AddTaskInline } from './AddTaskInline';
import { useConfirm } from './Confirm';
import { Drawer } from './Drawer';
import { AutoInput, AutoTextarea, Field } from './fields';
import { KIND_META, projectProgress, tasksForPerson, type PanelState } from './MemoryView';
import { TaskCheckbox } from './TaskCard';
import { Avatar } from './ui';

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'textarea' | 'select' | 'markdown';
  required?: boolean;
  placeholder?: string;
  rows?: number;
  options?: readonly string[];
  half?: boolean;
}

const FIELDS: Record<MemoryKind, FieldDef[]> = {
  people: [
    { key: 'nickname', label: 'Nickname', required: true, placeholder: 'What you call them', half: true },
    { key: 'fullName', label: 'Full name', placeholder: 'Full name', half: true },
    { key: 'role', label: 'Role', placeholder: 'e.g. Finance Manager', half: true },
    { key: 'company', label: 'Company', placeholder: 'e.g. Acme Corp', half: true },
    { key: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 4, placeholder: 'Preferences, context, history…' },
  ],
  projects: [
    { key: 'name', label: 'Name', required: true, placeholder: 'Project name' },
    { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUSES },
    { key: 'description', label: 'Description', type: 'textarea', rows: 4, placeholder: 'Goals, scope, links…' },
  ],
  glossary: [
    { key: 'term', label: 'Term', required: true, placeholder: 'e.g. EPBCS' },
    { key: 'meaning', label: 'Meaning', type: 'textarea', required: true, rows: 3, placeholder: 'e.g. Enterprise Planning and Budgeting Cloud Service' },
  ],
  notes: [
    { key: 'title', label: 'Title', required: true, placeholder: 'Note title' },
    { key: 'body', label: 'Note', type: 'markdown', rows: 16, placeholder: '# Heading\n- bullet\n**bold**, *italic*, `code`, [link](https://…)' },
  ],
};

const DEFAULTS: Record<MemoryKind, Record<string, unknown>> = { people: {}, projects: { status: 'active' }, glossary: {}, notes: {} };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

interface Props {
  state: NonNullable<PanelState>;
  setState: (s: PanelState) => void;
  onOpenTask: (id: number) => void;
}

export function MemoryPanel({ state, setState, onOpenTask }: Props) {
  const close = () => setState(null);
  if (state.id === 'new') return <NewItem kind={state.kind} onClose={close} onCreated={(id) => setState({ kind: state.kind, id })} />;
  return <EditItem kind={state.kind} id={state.id} onClose={close} onOpenTask={onOpenTask} />;
}

function NewItem({ kind, onClose, onCreated }: { kind: MemoryKind; onClose: () => void; onCreated: (id: number) => void }) {
  const { createItem } = useData();
  const [draft, setDraft] = useState<Record<string, unknown>>(DEFAULTS[kind]);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const fields = FIELDS[kind];
  const missing = fields.some((f) => f.required && !String(draft[f.key] ?? '').trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing || saving) return;
    setSaving(true);
    const saved = await createItem(kind, draft as never);
    setSaving(false);
    if (saved) onCreated(saved.id);
  };

  return (
    <Drawer
      label={`New ${KIND_META[kind].singular}`}
      title={`New ${KIND_META[kind].singular}`}
      onClose={onClose}
      wide={kind === 'notes'}
      footer={
        <>
          <span />
          <div className="footer-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" form={formId} disabled={missing || saving}>
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="field-flow">
        {fields.map((f, i) => (
          <DraftField key={f.key} def={f} value={String(draft[f.key] ?? '')} autoFocus={i === 0} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
        ))}
        {kind === 'projects' && <PeoplePicker value={(draft.personIds as number[]) ?? []} onChange={(personIds) => setDraft((d) => ({ ...d, personIds }))} />}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

function DraftField({ def, value, onChange, autoFocus }: { def: FieldDef; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const id = useId();
  const common = { id, value, autoFocus, placeholder: def.placeholder, className: 'input' };
  return (
    <div className={def.half ? 'half' : ''}>
      <Field label={def.label + (def.required ? ' *' : '')} htmlFor={id}>
        {def.type === 'textarea' || def.type === 'markdown' ? (
          <textarea {...common} className={`input textarea ${def.type === 'markdown' ? 'mono' : ''}`} rows={def.rows} onChange={(e) => onChange(e.target.value)} />
        ) : def.type === 'select' ? (
          <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
            {def.options!.map((o) => (
              <option key={o} value={o}>
                {cap(o)}
              </option>
            ))}
          </select>
        ) : (
          <input {...common} type={def.type ?? 'text'} onChange={(e) => onChange(e.target.value)} />
        )}
      </Field>
    </div>
  );
}

function EditItem({ kind, id, onClose, onOpenTask }: { kind: MemoryKind; id: number; onClose: () => void; onOpenTask: (id: number) => void }) {
  const { data, updateItem, deleteItem } = useData();
  const confirm = useConfirm();
  const item = (data[kind] as { id: number }[]).find((x) => x.id === id) as Record<string, unknown> | undefined;
  if (!item) return null;

  const save = (key: string, value: unknown) => void updateItem(kind, id, { [key]: value } as never);
  const name = String(item.nickname ?? item.name ?? item.term ?? item.title);

  const onDelete = async () => {
    const extra = kind === 'people' || kind === 'projects' ? ' Linked tasks are kept but will no longer be linked.' : '';
    const ok = await confirm({
      title: `Delete ${KIND_META[kind].singular}?`,
      message: `“${name}” will be permanently deleted.${extra}`,
      actions: [{ key: 'delete', label: 'Delete', variant: 'danger' }],
    });
    if (ok) {
      onClose();
      void deleteItem(kind, id);
    }
  };

  return (
    <Drawer
      label={`Edit ${KIND_META[kind].singular}`}
      title={<span className="drawer-kind">{KIND_META[kind].singular}</span>}
      onClose={onClose}
      wide={kind === 'notes'}
      footer={
        <>
          <span className="saved-hint">Changes save automatically</span>
          <button className="btn btn-ghost-danger" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
        </>
      }
    >
      {kind === 'people' && (
        <div className="panel-hero">
          <Avatar name={String(item.fullName || item.nickname)} size="lg" />
          <div>
            <div className="panel-hero-title">{String(item.nickname)}</div>
            <div className="muted">{[item.role, item.company].filter(Boolean).join(' · ') || 'No role yet'}</div>
          </div>
        </div>
      )}
      <div className="field-flow">
        {FIELDS[kind].map((f) => {
          const value = String(item[f.key] ?? '');
          const k = `${kind}-${id}-${f.key}`;
          if (f.type === 'select') {
            return (
              <Field key={k} label={f.label}>
                <select className="select" value={value} onChange={(e) => save(f.key, e.target.value)} aria-label={f.label}>
                  {f.options!.map((o) => (
                    <option key={o} value={o}>
                      {cap(o)}
                    </option>
                  ))}
                </select>
              </Field>
            );
          }
          if (f.type === 'markdown') return <MarkdownField key={k} label={f.label} value={value} rows={f.rows} placeholder={f.placeholder} onSave={(v) => save(f.key, v)} />;
          return (
            <div key={k} className={f.half ? 'half' : ''}>
              {f.type === 'textarea' ? (
                <AutoTextarea label={f.label} value={value} rows={f.rows} placeholder={f.placeholder} onSave={(v) => (f.required && !v.trim() ? undefined : save(f.key, v))} />
              ) : (
                <AutoInput label={f.label} type={f.type} value={value} required={f.required} placeholder={f.placeholder} onSave={(v) => save(f.key, v)} />
              )}
            </div>
          );
        })}
      </div>

      {kind === 'projects' && <ProjectProgressBlock projectId={id} />}
      {kind === 'projects' && <PeoplePicker value={(item as unknown as Project).personIds} onChange={(personIds) => save('personIds', personIds)} />}
      {kind === 'people' && (
        <LinkedTasks
          tasks={tasksForPerson(item as unknown as Person, data.tasks)}
          extra={{ personId: id, forPerson: (item as unknown as Person).nickname }}
          onOpenTask={onOpenTask}
        />
      )}
      {kind === 'projects' && <LinkedTasks tasks={data.tasks.filter((t) => t.projectId === id)} extra={{ projectId: id }} onOpenTask={onOpenTask} />}
      {kind === 'notes' && <p className="field-help">Edited {new Date((item as unknown as Note).updatedAt).toLocaleString()}</p>}
    </Drawer>
  );
}

/** Markdown body with Write / Preview tabs. */
function MarkdownField({ label, value, rows, placeholder, onSave }: { label: string; value: string; rows?: number; placeholder?: string; onSave: (v: string) => void }) {
  const [mode, setMode] = useState<'write' | 'preview'>(value ? 'preview' : 'write');
  return (
    <div className="md-field">
      <div className="md-field-head">
        <span className="field-label">{label}</span>
        <div className="segmented sm" role="tablist" aria-label="Note mode">
          <button role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')}>
            <Pencil size={13} /> Write
          </button>
          <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            <Eye size={13} /> Preview
          </button>
        </div>
      </div>
      {mode === 'write' ? (
        <AutoTextarea value={value} rows={rows} placeholder={placeholder} onSave={onSave} className="mono" />
      ) : (
        <div className="md-preview" onDoubleClick={() => setMode('write')} title="Double-click to edit">
          {value.trim() ? <Markdown source={value} /> : <p className="muted">Nothing here yet — switch to Write.</p>}
        </div>
      )}
    </div>
  );
}

function ProjectProgressBlock({ projectId }: { projectId: number }) {
  const { data } = useData();
  const { done, total, pct } = projectProgress(projectId, data.tasks);
  return (
    <div className="progress-wrap panel-progress">
      <div className="progress-meta">
        <span className="field-label">Progress</span>
        <span>{total ? `${done} of ${total} tasks done · ${pct}%` : 'No linked tasks yet'}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Project progress">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PeoplePicker({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const { data } = useData();
  return (
    <Field label="Related people">
      {data.people.length === 0 ? (
        <p className="muted small">Add people in the People section to link them here.</p>
      ) : (
        <div className="people-picker">
          {data.people.map((p) => {
            const on = value.includes(p.id);
            return (
              <button key={p.id} type="button" className={`person-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}>
                <Avatar name={p.fullName || p.nickname} size="xs" />
                {p.nickname}
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

function LinkedTasks({ tasks, extra, onOpenTask }: { tasks: Task[]; extra: Partial<Task>; onOpenTask: (id: number) => void }) {
  const sorted = [...tasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || byPosition(a, b));
  const open = tasks.filter((t) => t.status !== 'done').length;
  return (
    <section className="linked-tasks">
      <h3>
        Linked tasks <span className="count">{open} open · {tasks.length} total</span>
      </h3>
      {sorted.length === 0 ? (
        <p className="muted small">No linked tasks yet.</p>
      ) : (
        <ul>
          {sorted.map((t) => {
            const due = dueState(t);
            return (
              <li key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                <TaskCheckbox task={t} />
                <button className="linked-title" onClick={() => onOpenTask(t.id)}>
                  {t.title}
                </button>
                {t.dueDate && t.status !== 'done' && <span className={`chip chip-due ${due ?? ''}`}>{formatDay(t.dueDate)}</span>}
                <span className={`status-chip st-${t.status}`}>
                  <span className={`status-dot dot-${t.status}`} aria-hidden />
                  {t.status === 'waiting' ? 'Waiting' : cap(t.status)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <AddTaskInline status="active" extra={extra} placeholder="Add a linked task…" label="Add linked task" />
    </section>
  );
}
