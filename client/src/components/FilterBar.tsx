import { useMemo } from 'react';
import { AlertTriangle, CalendarRange, SlidersHorizontal, X } from 'lucide-react';
import { PRIORITIES } from '../../../shared/types';
import { useData } from '../store';
import { EMPTY_FILTERS, hasFilters, PRIORITY_LABEL, type TaskFilters } from '../utils';

interface Props {
  filters: TaskFilters;
  setFilters: (f: TaskFilters) => void;
  search: string;
  shown: number;
  total: number;
}

export function FilterBar({ filters, setFilters, search, shown, total }: Props) {
  const { data, peopleById } = useData();
  const tags = useMemo(() => [...new Set(data.tasks.flatMap((t) => t.tags))].sort(), [data.tasks]);
  const persons = useMemo(() => {
    const names = new Map<string, string>();
    for (const t of data.tasks) {
      if (t.forPerson) names.set(t.forPerson.toLowerCase(), t.forPerson);
      const p = t.personId ? peopleById.get(t.personId) : undefined;
      if (p) names.set(p.nickname.toLowerCase(), p.nickname);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [data.tasks, peopleById]);

  const set = <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => setFilters({ ...filters, [k]: v });
  const active = hasFilters(filters);

  return (
    <div className="filter-bar">
      <span className="filter-label">
        <SlidersHorizontal size={14} aria-hidden /> Filter
      </span>
      <select className={`select sm pill ${filters.tag ? 'on' : ''}`} aria-label="Filter by tag" value={filters.tag} onChange={(e) => set('tag', e.target.value)}>
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            #{t}
          </option>
        ))}
      </select>
      <select
        className={`select sm pill ${filters.priority ? 'on' : ''}`}
        aria-label="Filter by priority"
        value={filters.priority}
        onChange={(e) => set('priority', e.target.value as TaskFilters['priority'])}
      >
        <option value="">Any priority</option>
        {[...PRIORITIES].reverse().map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <select className={`select sm pill ${filters.person ? 'on' : ''}`} aria-label="Filter by person" value={filters.person} onChange={(e) => set('person', e.target.value)}>
        <option value="">Anyone</option>
        {persons.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button type="button" className={`toggle-chip danger ${filters.overdue ? 'on' : ''}`} aria-pressed={filters.overdue} onClick={() => set('overdue', !filters.overdue)}>
        <AlertTriangle size={13} aria-hidden /> Overdue
      </button>
      <button type="button" className={`toggle-chip ${filters.thisWeek ? 'on' : ''}`} aria-pressed={filters.thisWeek} onClick={() => set('thisWeek', !filters.thisWeek)}>
        <CalendarRange size={13} aria-hidden /> This week
      </button>
      {active && (
        <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>
          <X size={13} aria-hidden /> Clear
        </button>
      )}
      <span className="filter-count" aria-live="polite">
        {active || search ? `${shown} of ${total} tasks` : `${total} task${total === 1 ? '' : 's'}`}
      </span>
    </div>
  );
}
