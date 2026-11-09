import { useState } from 'react';
import { Calendar, CalendarClock, Check, CheckCircle2, Folder, Hourglass, Repeat } from 'lucide-react';
import type { Task } from '../../../shared/types';
import { useData } from '../store';
import { daysSince, dueState, formatDate, formatDay, formatSchedule, formatShort, lowerRelative, taskPersonName, todayStr, waitingLabel } from '../utils';
import { Avatar, PriorityDot } from './ui';

const COMPLETE_ANIM_MS = 320;

/**
 * Round checkbox. Completing plays a short check animation (and lets the card fade out)
 * before the task actually moves to Done.
 */
export function TaskCheckbox({ task, onAnimating }: { task: Task; onAnimating?: (on: boolean) => void }) {
  const { updateTask } = useData();
  const [pending, setPending] = useState(false);
  const done = task.status === 'done';
  const checked = done || pending;

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (pending) return;
    if (done) {
      void updateTask(task.id, { status: 'active' });
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setPending(true);
    onAnimating?.(true);
    window.setTimeout(() => {
      void updateTask(task.id, { status: 'done' }, { origin });
      setPending(false);
      onAnimating?.(false);
    }, COMPLETE_ANIM_MS);
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button
      type="button"
      className={`checkbox ${checked ? 'checked' : ''} ${pending ? 'popping' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
      onClick={onClick}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
    >
      <Check size={12} strokeWidth={3.2} aria-hidden />
    </button>
  );
}

export function TaskMeta({ task, showPerson = true }: { task: Task; showPerson?: boolean }) {
  const { peopleById, projectsById } = useData();
  const due = dueState(task);
  const person = taskPersonName(task, peopleById);
  const project = task.projectId ? projectsById.get(task.projectId) : undefined;
  const done = task.status === 'done';
  const showSchedule = !!task.scheduledDate && !done && (task.status === 'scheduled' || task.scheduledDate >= todayStr());

  return (
    <div className="tc-meta">
      {showSchedule && (
        <span className="chip chip-schedule" title="Scheduled">
          <CalendarClock size={12} aria-hidden />
          {formatSchedule(task)}
        </span>
      )}
      {task.dueDate && !done && (
        <span className={`chip chip-due ${due ?? ''}`} title={`Due ${task.dueDate}`}>
          <Calendar size={12} aria-hidden />
          {due === 'overdue' ? `Overdue · ${formatDay(task.dueDate)}` : `Due ${lowerRelative(formatDay(task.dueDate))}`}
        </span>
      )}
      {task.repeat !== 'none' && !done && (
        <span className="chip chip-icon" title={`Repeats ${task.repeat}`}>
          <Repeat size={12} aria-hidden />
          <span className="sr-only">Repeats {task.repeat}</span>
        </span>
      )}
      {task.status === 'waiting' && task.waitingSince && (
        <span className="chip chip-waiting" title={`Waiting since ${formatDate(task.waitingSince)}`}>
          <Hourglass size={12} aria-hidden />
          {waitingLabel(daysSince(task.waitingSince))}
        </span>
      )}
      {done && task.completedAt && (
        <span className="chip chip-done">
          <CheckCircle2 size={12} aria-hidden />
          {formatShort(task.completedAt)}
        </span>
      )}
      {project && (
        <span className="chip" title="Project">
          <Folder size={12} aria-hidden />
          {project.name}
        </span>
      )}
      {task.tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
      {showPerson && person && (
        <span className="tc-person">
          <Avatar name={person} size="sm" title={`For ${person}`} />
        </span>
      )}
    </div>
  );
}

/** Board card. `overlay` is the floating copy shown while dragging. */
export function TaskCard({ task, overlay }: { task: Task; overlay?: boolean }) {
  const { recent } = useData();
  const [completing, setCompleting] = useState(false);
  const due = dueState(task);
  const done = task.status === 'done';

  return (
    <div
      className={[
        'task-card',
        done && 'is-done',
        overlay && 'overlay',
        completing && 'completing',
        recent.has(task.id) && !overlay && 'enter',
        due && `due-${due}`,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="tc-top">
        <TaskCheckbox task={task} onAnimating={setCompleting} />
        <span className="tc-title">{task.title}</span>
        {!done && <PriorityDot priority={task.priority} />}
      </div>
      {task.notes && <div className="tc-notes">{task.notes.split('\n')[0]}</div>}
      <TaskMeta task={task} />
    </div>
  );
}
