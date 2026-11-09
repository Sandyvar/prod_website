import { useCallback, useMemo } from 'react';
import type { View } from '../../../shared/types';
import { useData } from '../store';
import { EMPTY_FILTERS, hasFilters, matchesFilters, useLocalStorage, type TaskFilters } from '../utils';
import { CalendarView } from './CalendarView';
import { FilterBar } from './FilterBar';
import { Greeting } from './Greeting';
import { ListView } from './ListView';
import { TaskBoard } from './TaskBoard';
import { ViewToggle } from './ui';

interface Props {
  view: View;
  setView: (v: View) => void;
  search: string;
  onOpenTask: (id: number) => void;
  onNewOnDay: (date: string) => void;
  onSetName: () => void;
}

export function TasksPage({ view, setView, search, onOpenTask, onNewOnDay, onSetName }: Props) {
  const { data, peopleById } = useData();
  const [filters, setFilters] = useLocalStorage<TaskFilters>('task-filters-v2', EMPTY_FILTERS);
  const visible = useMemo(() => data.tasks.filter((t) => matchesFilters(t, filters, search, peopleById)), [data.tasks, filters, search, peopleById]);
  const filtered = hasFilters(filters, search);
  const toggleOverdue = useCallback(() => setFilters((f) => ({ ...f, overdue: !f.overdue })), [setFilters]);

  return (
    <div className="tasks-page">
      <Greeting onOverdue={toggleOverdue} overdueOn={filters.overdue} onSetName={onSetName} />
      <div className="tasks-toolbar">
        <FilterBar filters={filters} setFilters={setFilters} search={search} shown={visible.length} total={data.tasks.length} />
        <ViewToggle view={view} onChange={setView} className="mobile-view" />
      </div>
      {view === 'board' && <TaskBoard tasks={visible} onOpen={onOpenTask} filtered={filtered} />}
      {view === 'list' && <ListView tasks={visible} onOpen={onOpenTask} filtered={filtered} />}
      {view === 'calendar' && <CalendarView tasks={visible} onOpen={onOpenTask} onNewOnDay={onNewOnDay} />}
    </div>
  );
}
