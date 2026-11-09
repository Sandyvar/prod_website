import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Calendar, CalendarClock, ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import type { Task } from '../../../shared/types';
import { useData } from '../store';
import { dueState, formatDay, formatTime, toDateStr, todayStr, useLocalStorage, WEEK_OPTS } from '../utils';
import { useToast } from './Toasts';
import { TaskCheckbox } from './TaskCard';
import { EmptyState, PriorityDot } from './ui';

type Mode = 'month' | 'week';

/** One appearance of a task on the calendar: on its scheduled date and/or its due date. */
interface Entry {
  key: string;
  kind: 'scheduled' | 'due';
  task: Task;
  date: string;
}

function buildEntries(tasks: Task[]): Map<string, Entry[]> {
  const byDay = new Map<string, Entry[]>();
  const add = (e: Entry) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (t.scheduledDate) add({ key: `scheduled:${t.id}`, kind: 'scheduled', task: t, date: t.scheduledDate });
    if (t.dueDate && t.dueDate !== t.scheduledDate) add({ key: `due:${t.id}`, kind: 'due', task: t, date: t.dueDate });
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.task.scheduledTime ?? '99').localeCompare(b.task.scheduledTime ?? '99') || a.task.title.localeCompare(b.task.title));
  }
  return byDay;
}

interface Props {
  tasks: Task[];
  onOpen: (id: number) => void;
  onNewOnDay: (date: string) => void;
}

export function CalendarView({ tasks, onOpen, onNewOnDay }: Props) {
  const { updateTask } = useData();
  const toast = useToast();
  const [mode, setMode] = useLocalStorage<Mode>('calendar-mode', 'month');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(todayStr());
  const [dragging, setDragging] = useState<Entry | null>(null);

  const entries = useMemo(() => buildEntries(tasks), [tasks]);
  const days = useMemo(() => {
    const start = mode === 'month' ? startOfWeek(startOfMonth(cursor), WEEK_OPTS) : startOfWeek(cursor, WEEK_OPTS);
    const end = mode === 'month' ? endOfWeek(endOfMonth(cursor), WEEK_OPTS) : endOfWeek(cursor, WEEK_OPTS);
    return eachDayOfInterval({ start, end });
  }, [cursor, mode]);

  const step = (n: number) => setCursor((c) => (mode === 'month' ? addMonths(c, n) : addWeeks(c, n)));
  const title =
    mode === 'month'
      ? format(cursor, 'MMMM yyyy')
      : `${format(days[0], 'MMM d')} – ${format(days[6], isSameMonth(days[0], days[6]) ? 'd, yyyy' : 'MMM d, yyyy')}`;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = ({ active }: DragStartEvent) => setDragging((active.data.current as { entry: Entry }).entry);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const entry = (active.data.current as { entry: Entry }).entry;
    const date = String(over.id).replace('day:', '');
    if (date === entry.date) return;
    void updateTask(entry.task.id, entry.kind === 'scheduled' ? { scheduledDate: date } : { dueDate: date }, { silent: true });
    toast.success(`${entry.kind === 'scheduled' ? 'Rescheduled' : 'Due date moved'} to ${formatDay(date)}`);
    setSelected(date);
  };

  const today = todayStr();
  const selectedEntries = entries.get(selected) ?? [];

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="icon-btn bordered" onClick={() => step(-1)} aria-label={`Previous ${mode}`}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-sm" onClick={() => (setCursor(new Date()), setSelected(today))}>
            Today
          </button>
          <button className="icon-btn bordered" onClick={() => step(1)} aria-label={`Next ${mode}`}>
            <ChevronRight size={16} />
          </button>
          <h2 className="cal-title">{title}</h2>
        </div>
        <div className="cal-legend" aria-hidden>
          <span>
            <i className="lg lg-scheduled" /> Scheduled
          </span>
          <span>
            <i className="lg lg-due" /> Due
          </span>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Calendar range">
          {(['month', 'week'] as Mode[]).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'month' ? 'Month' : 'Week'}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={{ threshold: { x: 0, y: 0.06 }, acceleration: 6 }} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className={`cal-grid cal-${mode}`} role="grid" aria-label={title}>
          {days.slice(0, 7).map((d) => (
            <div key={d.toISOString()} className="cal-weekday" role="columnheader">
              {format(d, 'EEE')}
            </div>
          ))}
          {days.map((d) => {
            const ds = toDateStr(d);
            return (
              <DayCell
                key={ds}
                date={ds}
                day={d}
                mode={mode}
                outside={mode === 'month' && !isSameMonth(d, cursor)}
                today={ds === today}
                selected={ds === selected}
                entries={entries.get(ds) ?? []}
                onSelect={() => setSelected(ds)}
                onOpen={onOpen}
                onNew={() => onNewOnDay(ds)}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <Chip entry={dragging} overlay /> : null}</DragOverlay>
      </DndContext>

      <section className="agenda" aria-label={`Tasks on ${formatDay(selected)}`}>
        <header className="agenda-header">
          <h3>{format(new Date(`${selected}T00:00`), 'EEEE, MMMM d')}</h3>
          <button className="btn btn-sm" onClick={() => onNewOnDay(selected)}>
            <Plus size={14} /> Add task
          </button>
        </header>
        {selectedEntries.length === 0 ? (
          <EmptyState icon={Calendar} text="Nothing on this day." compact />
        ) : (
          <ul>
            {selectedEntries.map((e) => (
              <li key={e.key} className="agenda-row" onClick={() => onOpen(e.task.id)}>
                <TaskCheckbox task={e.task} />
                <span className="agenda-title">{e.task.title}</span>
                <span className={`chip ${e.kind === 'scheduled' ? 'chip-schedule' : `chip-due ${dueState(e.task) ?? ''}`}`}>
                  {e.kind === 'scheduled' ? <CalendarClock size={12} /> : <Calendar size={12} />}
                  {e.kind === 'scheduled' ? (e.task.scheduledTime ? formatTime(e.task.scheduledTime) : 'Scheduled') : 'Due'}
                </span>
                <PriorityDot priority={e.task.priority} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface DayCellProps {
  date: string;
  day: Date;
  mode: Mode;
  outside: boolean;
  today: boolean;
  selected: boolean;
  entries: Entry[];
  onSelect: () => void;
  onOpen: (id: number) => void;
  onNew: () => void;
}

function DayCell({ date, day, mode, outside, today, selected, entries, onSelect, onOpen, onNew }: DayCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });
  const limit = mode === 'month' ? 3 : 50;
  const shown = entries.slice(0, limit);
  const more = entries.length - shown.length;
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-selected={selected}
      aria-label={`${format(day, 'EEEE, MMMM d')}, ${entries.length} task${entries.length === 1 ? '' : 's'}`}
      className={['cal-day', outside && 'outside', today && 'today', selected && 'selected', isOver && 'is-over'].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      <div className="cal-day-head">
        <span className="cal-date">{mode === 'week' ? format(day, 'EEE d') : format(day, 'd')}</span>
        <button
          className="cal-add"
          aria-label={`Add task on ${format(day, 'MMMM d')}`}
          onClick={(e) => {
            e.stopPropagation();
            onNew();
          }}
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="cal-chips">
        {shown.map((e) => (
          <DraggableChip key={e.key} entry={e} onOpen={onOpen} />
        ))}
        {more > 0 && <span className="cal-more">+{more} more</span>}
      </div>
      {entries.length > 0 && (
        <div className="cal-dots" aria-hidden>
          {entries.slice(0, 4).map((e) => (
            <i key={e.key} className={`lg lg-${e.kind}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableChip({ entry, onOpen }: { entry: Entry; onOpen: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.key, data: { entry } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cal-chip-wrap ${isDragging ? 'is-dragging' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(entry.task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(entry.task.id);
        else listeners?.onKeyDown?.(e);
      }}
      aria-label={`${entry.task.title} (${entry.kind}). Drag to another day to reschedule.`}
    >
      <Chip entry={entry} />
    </div>
  );
}

function Chip({ entry, overlay }: { entry: Entry; overlay?: boolean }) {
  const { task, kind } = entry;
  const due = kind === 'due' ? dueState(task) : null;
  return (
    <div className={`cal-chip kind-${kind} ${due ?? ''} ${overlay ? 'overlay' : ''}`} title={task.title}>
      {kind === 'scheduled' && task.scheduledTime && <span className="cal-time">{formatTime(task.scheduledTime).replace(':00', '')}</span>}
      {kind === 'due' && <Calendar size={11} aria-hidden className="cal-chip-icon" />}
      <span className="cal-chip-title">{task.title}</span>
      {task.repeat !== 'none' && <Repeat size={11} aria-hidden className="cal-chip-icon" />}
    </div>
  );
}
