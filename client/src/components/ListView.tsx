import { useMemo, useState } from 'react';
import { ArrowUpDown, SearchX } from 'lucide-react';
import { STATUSES, STATUS_LABELS, type Status, type Task } from '../../../shared/types';
import { useData } from '../store';
import { PRIORITY_RANK, useLocalStorage } from '../utils';
import { AddTaskInline } from './AddTaskInline';
import { EMPTY, sortColumn } from './TaskBoard';
import { TaskCheckbox, TaskMeta } from './TaskCard';
import { EmptyState, PriorityDot, StatusDot } from './ui';

type SortKey = 'manual' | 'due' | 'priority';
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'manual', label: 'Manual order' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
];

/** Earliest relevant date: due date, else scheduled date. Undated tasks sort last. */
const dateKey = (t: Task) => [t.dueDate, t.scheduledDate].filter(Boolean).sort()[0] ?? '9999-99-99';

function sortTasks(status: Status, tasks: Task[], key: SortKey) {
  const base = sortColumn(status, tasks);
  if (key === 'due') return [...base].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  if (key === 'priority') return [...base].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  return base;
}

export function ListView({ tasks, onOpen, filtered }: { tasks: Task[]; onOpen: (id: number) => void; filtered: boolean }) {
  const [sort, setSort] = useLocalStorage<SortKey>('list-sort', 'manual');
  const [showAllDone, setShowAllDone] = useState(false);
  const groups = useMemo(
    () => Object.fromEntries(STATUSES.map((s) => [s, sortTasks(s, tasks.filter((t) => t.status === s), sort)])) as Record<Status, Task[]>,
    [tasks, sort],
  );

  return (
    <div className="list-view">
      <div className="list-toolbar">
        <label className="sort-label" htmlFor="list-sort">
          <ArrowUpDown size={14} aria-hidden /> Sort by
        </label>
        <select id="list-sort" className="select sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {STATUSES.map((status) => {
        let rows = groups[status];
        const hidden = status === 'done' && !showAllDone ? Math.max(0, rows.length - 25) : 0;
        if (hidden) rows = rows.slice(0, 25);
        const empty = filtered ? { icon: SearchX, text: 'No matching tasks' } : EMPTY[status];
        return (
          <section key={status} className={`list-group col-${status}`} aria-label={STATUS_LABELS[status]}>
            <header className="list-group-header">
              <StatusDot status={status} />
              <h2>{STATUS_LABELS[status]}</h2>
              <span className="count">{groups[status].length}</span>
            </header>
            <div className="list-rows">
              {rows.length === 0 && <EmptyState icon={empty.icon} text={empty.text} compact />}
              {rows.map((t) => (
                <ListRow key={t.id} task={t} onOpen={onOpen} />
              ))}
              {hidden > 0 && (
                <button className="link-btn list-more" onClick={() => setShowAllDone(true)}>
                  Show {hidden} more
                </button>
              )}
            </div>
            <AddTaskInline status={status} label={status === 'done' ? 'Log a finished task' : 'Add a task'} />
          </section>
        );
      })}
    </div>
  );
}

function ListRow({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { recent } = useData();
  const [completing, setCompleting] = useState(false);
  const done = task.status === 'done';
  return (
    <div
      className={`list-row ${done ? 'is-done' : ''} ${completing ? 'completing' : ''} ${recent.has(task.id) ? 'enter' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(task.id);
      }}
    >
      <TaskCheckbox task={task} onAnimating={setCompleting} />
      <span className="lr-title">{task.title}</span>
      <TaskMeta task={task} />
      {!done && <PriorityDot priority={task.priority} />}
    </div>
  );
}
