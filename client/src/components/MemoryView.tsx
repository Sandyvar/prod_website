import { useMemo, useState } from 'react';
import { BookA, FolderKanban, LayoutGrid, Mail, NotebookPen, Plus, SearchX, Users, type LucideIcon } from 'lucide-react';
import type { GlossaryTerm, Note, Person, Project, Task } from '../../../shared/types';
import { useData, type MemoryKind } from '../store';
import { formatDate, useLocalStorage } from '../utils';
import { markdownToText } from '../markdown';
import { MemoryPanel } from './MemoryPanel';
import { Avatar, EmptyState } from './ui';

export const KIND_META: Record<MemoryKind, { label: string; singular: string; empty: string; icon: LucideIcon }> = {
  people: { label: 'People', singular: 'person', empty: 'Keep track of who’s who — colleagues, clients, stakeholders.', icon: Users },
  projects: { label: 'Projects', singular: 'project', empty: 'Group related people and tasks under a project.', icon: FolderKanban },
  glossary: { label: 'Glossary', singular: 'term', empty: 'Decode acronyms and jargon, e.g. EPBCS.', icon: BookA },
  notes: { label: 'Notes', singular: 'note', empty: 'Jot down anything worth remembering. Markdown supported.', icon: NotebookPen },
};
const KINDS: MemoryKind[] = ['people', 'projects', 'glossary', 'notes'];
type Section = 'all' | MemoryKind;

export type PanelState = { kind: MemoryKind; id: number | 'new' } | null;

/** Tasks linked to a person: explicit link, or "for" text matching their nickname / full name. */
export function tasksForPerson(p: Person, tasks: Task[]) {
  const names = [p.nickname, p.fullName].filter(Boolean).map((s) => s.toLowerCase());
  return tasks.filter((t) => t.personId === p.id || (t.forPerson && names.includes(t.forPerson.toLowerCase())));
}

export function projectProgress(projectId: number, tasks: Task[]) {
  const linked = tasks.filter((t) => t.projectId === projectId);
  const done = linked.filter((t) => t.status === 'done').length;
  return { done, total: linked.length, pct: linked.length ? Math.round((done / linked.length) * 100) : 0 };
}

export function MemoryView({ search, onOpenTask }: { search: string; onOpenTask: (id: number) => void }) {
  const { data } = useData();
  const [section, setSection] = useLocalStorage<Section>('memory-section', 'all');
  const [panel, setPanel] = useState<PanelState>(null);

  const q = search.trim().toLowerCase();
  const match = (...fields: string[]) => !q || q.split(/\s+/).every((w) => fields.join(' ').toLowerCase().includes(w));

  const lists = useMemo(
    () => ({
      people: [...data.people].sort((a, b) => a.nickname.localeCompare(b.nickname)).filter((p) => match(p.nickname, p.fullName, p.role, p.company, p.email, p.notes)),
      projects: data.projects.filter((p) => match(p.name, p.status, p.description)),
      glossary: [...data.glossary].sort((a, b) => a.term.localeCompare(b.term)).filter((g) => match(g.term, g.meaning)),
      notes: [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((n) => match(n.title, n.body)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.people, data.projects, data.glossary, data.notes, q],
  );

  const open = (kind: MemoryKind, id: number | 'new') => setPanel({ kind, id });
  const kindsShown: MemoryKind[] = section === 'all' ? KINDS : [section];
  const nothing = kindsShown.every((k) => lists[k].length === 0);

  return (
    <div className="memory">
      <nav className="memory-nav" aria-label="Memory sections">
        <MenuItem icon={LayoutGrid} label="All" count={KINDS.reduce((n, k) => n + data[k].length, 0)} active={section === 'all'} onClick={() => setSection('all')} />
        {KINDS.map((k) => (
          <MenuItem key={k} icon={KIND_META[k].icon} label={KIND_META[k].label} count={data[k].length} active={section === k} onClick={() => setSection(k)} />
        ))}
      </nav>

      <div className="memory-content">
        <header className="memory-head">
          <div>
            <h1>{section === 'all' ? 'Memory' : KIND_META[section].label}</h1>
            <p className="muted">{section === 'all' ? 'People, projects, terms and notes — everything worth remembering.' : KIND_META[section].empty}</p>
          </div>
          {section !== 'all' && (
            <button className="btn btn-primary" onClick={() => open(section, 'new')}>
              <Plus size={16} /> Add {KIND_META[section].singular}
            </button>
          )}
        </header>

        {q && nothing && <EmptyState icon={SearchX} text={`Nothing matches “${search}”.`} />}

        {kindsShown.map((k) => {
          const items = lists[k];
          if (section === 'all' && (q ? items.length === 0 : false)) return null;
          const limit = section === 'all' ? (k === 'glossary' ? 5 : 4) : Infinity;
          const Icon = KIND_META[k].icon;
          return (
            <section key={k} className="memory-section" aria-label={KIND_META[k].label}>
              {section === 'all' && (
                <div className="memory-section-head">
                  <h2>
                    <Icon size={16} aria-hidden /> {KIND_META[k].label} <span className="count">{items.length}</span>
                  </h2>
                  <div className="msh-actions">
                    {items.length > limit && (
                      <button className="link-btn" onClick={() => setSection(k)}>
                        View all
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={() => open(k, 'new')}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </div>
              )}
              {items.length === 0 ? (
                !q && <EmptyState icon={Icon} text={KIND_META[k].empty} compact={section === 'all'} />
              ) : k === 'glossary' ? (
                <GlossaryTable terms={(items as GlossaryTerm[]).slice(0, limit)} onOpen={(id) => open('glossary', id)} />
              ) : (
                <div className="card-grid">
                  {k === 'people' && (items as Person[]).slice(0, limit).map((p) => <PersonCard key={p.id} person={p} onClick={() => open('people', p.id)} onOpenTask={onOpenTask} />)}
                  {k === 'projects' && (items as Project[]).slice(0, limit).map((p) => <ProjectCard key={p.id} project={p} onClick={() => open('projects', p.id)} />)}
                  {k === 'notes' && (items as Note[]).slice(0, limit).map((n) => <NoteCard key={n.id} note={n} onClick={() => open('notes', n.id)} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {panel && <MemoryPanel state={panel} setState={setPanel} onOpenTask={onOpenTask} />}
    </div>
  );
}

function MenuItem({ icon: Icon, label, count, active, onClick }: { icon: LucideIcon; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button className={`menu-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon size={16} aria-hidden />
      <span className="mi-label">{label}</span>
      <span className="mi-count">{count}</span>
    </button>
  );
}

function PersonCard({ person, onClick, onOpenTask }: { person: Person; onClick: () => void; onOpenTask: (id: number) => void }) {
  const { data } = useData();
  const openTasks = tasksForPerson(person, data.tasks).filter((t) => t.status !== 'done');
  const sub = [person.role, person.company].filter(Boolean).join(' · ');
  return (
    <article className="card memory-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="card-head">
        <Avatar name={person.fullName || person.nickname} size="lg" />
        <div className="card-head-text">
          <h3 className="card-title">{person.nickname}</h3>
          {person.fullName && <div className="card-sub">{person.fullName}</div>}
        </div>
      </div>
      {sub && <div className="card-line">{sub}</div>}
      {person.email && (
        <a className="card-line link" href={`mailto:${person.email}`} onClick={(e) => e.stopPropagation()}>
          <Mail size={13} aria-hidden /> {person.email}
        </a>
      )}
      <div className="card-tasks">
        <div className="card-tasks-label">{openTasks.length ? `${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}` : 'No open tasks'}</div>
        {openTasks.slice(0, 3).map((t) => (
          <button
            key={t.id}
            className="mini-task"
            onClick={(e) => {
              e.stopPropagation();
              onOpenTask(t.id);
            }}
          >
            <span className={`status-dot dot-${t.status}`} aria-hidden />
            <span className="mini-task-title">{t.title}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const { data, peopleById } = useData();
  const { done, total, pct } = projectProgress(project.id, data.tasks);
  return (
    <article className="card memory-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="card-head">
        <span className="project-icon" aria-hidden>
          <FolderKanban size={18} />
        </span>
        <div className="card-head-text">
          <h3 className="card-title">{project.name}</h3>
          <ProjectStatusChip status={project.status} />
        </div>
      </div>
      {project.description && <p className="card-desc">{project.description}</p>}
      <div className="progress-wrap">
        <div className="progress-meta">
          <span>{total ? `${done} of ${total} tasks done` : 'No linked tasks yet'}</span>
          {total > 0 && <span className="progress-pct">{pct}%</span>}
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${project.name} progress`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {project.personIds.length > 0 && (
        <div className="avatar-stack">
          {project.personIds.slice(0, 6).map((id) => {
            const p = peopleById.get(id);
            return p ? <Avatar key={id} name={p.fullName || p.nickname} size="sm" title={p.nickname} /> : null;
          })}
        </div>
      )}
    </article>
  );
}

export function ProjectStatusChip({ status }: { status: Project['status'] }) {
  return <span className={`status-chip ps-${status.replace(' ', '-')}`}>{status[0].toUpperCase() + status.slice(1)}</span>;
}

function GlossaryTable({ terms, onOpen }: { terms: GlossaryTerm[]; onOpen: (id: number) => void }) {
  return (
    <div className="table-card">
      <table className="glossary-table">
        <thead>
          <tr>
            <th scope="col">Term</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((g) => (
            <tr key={g.id} onClick={() => onOpen(g.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(g.id)}>
              <th scope="row">{g.term}</th>
              <td>{g.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NoteCard({ note, onClick }: { note: Note; onClick: () => void }) {
  return (
    <article className="card memory-card note-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <h3 className="card-title">{note.title}</h3>
      {note.body && <p className="card-desc note-preview">{markdownToText(note.body)}</p>}
      <div className="card-line muted">Edited {formatDate(note.updatedAt)}</div>
    </article>
  );
}
