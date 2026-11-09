import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, CheckCircle2, Coffee, Hourglass, SearchX, type LucideIcon } from 'lucide-react';
import { STATUSES, STATUS_LABELS, type Status, type Task } from '../../../shared/types';
import { useData } from '../store';
import { byPosition, bySchedule, dayFromToday, formatDay, scheduleGroup } from '../utils';
import { useToast } from './Toasts';
import { AddTaskInline } from './AddTaskInline';
import { TaskCard } from './TaskCard';
import { EmptyState, StatusDot } from './ui';

type Columns = Record<Status, number[]>;
const DONE_LIMIT = 25;

export const EMPTY: Record<Status, { icon: LucideIcon; text: string }> = {
  active: { icon: Coffee, text: 'Nothing on your plate. Enjoy it.' },
  scheduled: { icon: CalendarClock, text: 'Nothing scheduled yet.' },
  waiting: { icon: Hourglass, text: 'Not waiting on anyone.' },
  done: { icon: CheckCircle2, text: 'Finished tasks land here.' },
};

/** Column contents in display order: Scheduled follows the calendar, everything else the manual order. */
export function sortColumn(status: Status, tasks: Task[]) {
  return [...tasks].sort(status === 'scheduled' ? bySchedule : byPosition);
}

interface Props {
  tasks: Task[]; // after search/filters
  onOpen: (id: number) => void;
  filtered: boolean;
}

export function TaskBoard({ tasks, onOpen, filtered }: Props) {
  const { data, moveTask, updateTask } = useData();
  const toast = useToast();
  const [showAllDone, setShowAllDone] = useState(false);
  const [dragCols, setDragCols] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  const tasksById = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);

  const { baseCols, doneHidden } = useMemo(() => {
    const cols = Object.fromEntries(STATUSES.map((s) => [s, sortColumn(s, tasks.filter((t) => t.status === s)).map((t) => t.id)])) as Columns;
    const hidden = showAllDone ? 0 : Math.max(0, cols.done.length - DONE_LIMIT);
    if (hidden) cols.done = cols.done.slice(0, DONE_LIMIT);
    return { baseCols: cols, doneHidden: hidden };
  }, [tasks, showAllDone]);

  const cols = dragCols ?? baseCols;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const findCol = (id: UniqueIdentifier, c: Columns): Status | undefined => {
    if (typeof id === 'string' && (STATUSES as readonly string[]).includes(id)) return id as Status;
    return STATUSES.find((s) => c[s].includes(id as number));
  };

  /*
   * Multi-column collision detection (the approach from dnd-kit's own multiple-containers example).
   * Plain closestCorners can oscillate between two columns while a card is mid-move — each move
   * changes the layout, which changes the collision, which moves it back — until React bails out
   * with "Maximum update depth exceeded". Pointer-first detection plus remembering the last target
   * right after a cross-column move keeps it stable.
   */
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const movedToNewColumn = useRef(false);
  useEffect(() => {
    requestAnimationFrame(() => {
      movedToNewColumn.current = false;
    });
  }, [dragCols]);

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const pointer = pointerWithin(args);
      const hits = pointer.length > 0 ? pointer : rectIntersection(args);
      let overId = getFirstCollision(hits, 'id');
      if (overId != null) {
        if ((STATUSES as readonly UniqueIdentifier[]).includes(overId)) {
          // Over a column: target the closest card inside it, if it has any.
          const items = cols[overId as Status];
          if (items.length > 0) {
            overId =
              closestCenter({
                ...args,
                droppableContainers: args.droppableContainers.filter((c) => c.id !== overId && items.includes(c.id as number)),
              })[0]?.id ?? overId;
          }
        }
        lastOverId.current = overId;
        return [{ id: overId }];
      }
      if (movedToNewColumn.current) lastOverId.current = activeId;
      return lastOverId.current != null ? [{ id: lastOverId.current }] : [];
    },
    [activeId, cols],
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as number);
    setDragCols(baseCols);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || over.id === active.id) return;
    setDragCols((prev) => {
      if (!prev) return prev;
      const from = findCol(active.id, prev);
      const to = findCol(over.id, prev);
      if (!from || !to || from === to) return prev;
      movedToNewColumn.current = true;
      const toItems = prev[to].filter((i) => i !== active.id);
      let idx = typeof over.id === 'number' ? toItems.indexOf(over.id) : toItems.length;
      const translated = active.rect.current.translated;
      if (typeof over.id === 'number' && translated && translated.top > over.rect.top + over.rect.height / 2) idx += 1;
      if (idx < 0) idx = toItems.length;
      toItems.splice(idx, 0, active.id as number);
      return { ...prev, [from]: prev[from].filter((i) => i !== active.id), [to]: toItems };
    });
  };

  const reset = () => {
    setActiveId(null);
    setDragCols(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const c = dragCols;
    reset();
    const id = active.id as number;
    const task = tasksById.get(id);
    if (!over || !c || !task) return;
    const col = findCol(id, c);
    if (!col) return;

    // Scheduled is ordered by date, so dropping there only needs a date — not a position.
    if (col === 'scheduled') {
      if (task.status === 'scheduled') return;
      const scheduledDate = task.scheduledDate ?? dayFromToday(1);
      void updateTask(id, { status: 'scheduled', scheduledDate });
      if (!task.scheduledDate) toast.info(`Scheduled for ${formatDay(scheduledDate).toLowerCase()} — open the task to change the date`);
      return;
    }

    let visible = c[col];
    if (typeof over.id === 'number' && over.id !== id && findCol(over.id, c) === col) {
      visible = arrayMove(visible, visible.indexOf(id), visible.indexOf(over.id));
    }
    if (col === task.status && visible.join() === baseCols[col].join()) return;

    // Merge the visible order back into the full column (which may contain filtered-out tasks).
    const full = data.tasks
      .filter((t) => t.status === col && t.id !== id)
      .sort(byPosition)
      .map((t) => t.id);
    const i = visible.indexOf(id);
    const next = visible[i + 1];
    const prev = visible[i - 1];
    let at = full.length;
    if (next !== undefined && full.includes(next)) at = full.indexOf(next);
    else if (prev !== undefined && full.includes(prev)) at = full.indexOf(prev) + 1;
    full.splice(at, 0, id);
    void moveTask(id, col, full);
  };

  const activeTask = activeId !== null ? tasksById.get(activeId) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={reset}>
      <div className="board">
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            ids={cols[status]}
            tasksById={tasksById}
            onOpen={onOpen}
            filtered={filtered}
            total={status === 'done' ? cols.done.length + doneHidden : cols[status].length}
            footer={
              status === 'done' && (doneHidden > 0 || showAllDone) && cols.done.length >= DONE_LIMIT ? (
                <button className="link-btn" onClick={() => setShowAllDone((v) => !v)}>
                  {showAllDone ? 'Show fewer' : `Show ${doneHidden} more`}
                </button>
              ) : null
            }
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {activeTask ? <TaskCard task={activeTask} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface ColumnProps {
  status: Status;
  ids: number[];
  tasksById: Map<number, Task>;
  onOpen: (id: number) => void;
  footer: ReactNode;
  total: number;
  filtered: boolean;
}

function Column({ status, ids, tasksById, onOpen, footer, total, filtered }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const empty = filtered ? { icon: SearchX, text: 'No matching tasks' } : EMPTY[status];

  let lastGroup = '';
  return (
    <section className={`column col-${status} ${isOver ? 'is-over' : ''}`} aria-label={STATUS_LABELS[status]}>
      <header className="column-header">
        <StatusDot status={status} />
        <h2>{STATUS_LABELS[status]}</h2>
        <span className="count">{total}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="column-body">
          {ids.map((id) => {
            const t = tasksById.get(id);
            if (!t) return null;
            let heading: string | null = null;
            if (status === 'scheduled' && t.status === 'scheduled' && t.scheduledDate) {
              const g = scheduleGroup(t.scheduledDate);
              if (g !== lastGroup) heading = lastGroup = g;
            }
            return (
              <Fragment key={id}>
                {heading && <div className="group-heading">{heading}</div>}
                <SortableTask task={t} onOpen={onOpen} />
              </Fragment>
            );
          })}
          {ids.length === 0 && <EmptyState icon={empty.icon} text={empty.text} compact />}
        </div>
      </SortableContext>
      {footer && <div className="column-footer">{footer}</div>}
      <AddTaskInline status={status} label={status === 'done' ? 'Log a finished task' : 'Add a task'} />
    </section>
  );
}

function SortableTask({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sortable ${isDragging ? 'is-dragging' : ''}`}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      aria-label={`${task.title}. Press Enter to edit, Space to pick up.`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isDragging) {
          e.preventDefault();
          onOpen(task.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <TaskCard task={task} />
    </div>
  );
}
