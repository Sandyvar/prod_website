import { useEffect, useMemo, useState } from 'react';
import { startOfWeek } from 'date-fns';
import { AlertTriangle, CalendarCheck, CheckCircle2, ListTodo, type LucideIcon } from 'lucide-react';
import { useData } from '../store';
import { dueState, greeting, todayStr, WEEK_OPTS } from '../utils';

interface Stat {
  key: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone: 'accent' | 'info' | 'danger' | 'success';
  onClick?: () => void;
  active?: boolean;
}

export function Greeting({ onOverdue, overdueOn, onSetName }: { onOverdue: () => void; overdueOn: boolean; onSetName: () => void }) {
  const { data } = useData();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo<Stat[]>(() => {
    const today = todayStr();
    const weekStart = startOfWeek(now, WEEK_OPTS).getTime();
    const open = data.tasks.filter((t) => t.status !== 'done');
    return [
      { key: 'active', label: 'Active', value: data.tasks.filter((t) => t.status === 'active').length, icon: ListTodo, tone: 'accent' },
      {
        key: 'today',
        label: 'Due today',
        value: open.filter((t) => t.dueDate === today || (t.status === 'scheduled' && t.scheduledDate === today)).length,
        icon: CalendarCheck,
        tone: 'info',
      },
      {
        key: 'overdue',
        label: 'Overdue',
        value: open.filter((t) => dueState(t) === 'overdue').length,
        icon: AlertTriangle,
        tone: 'danger',
        onClick: onOverdue,
        active: overdueOn,
      },
      {
        key: 'week',
        label: 'Completed this week',
        value: data.tasks.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() >= weekStart).length,
        icon: CheckCircle2,
        tone: 'success',
      },
    ];
  }, [data.tasks, now, onOverdue, overdueOn]);

  const name = data.settings.name.trim();
  return (
    <section className="greeting-row" aria-label="Overview">
      <div className="greeting">
        <h1>
          {greeting(now)}
          {name ? `, ${name}` : ''}
        </h1>
        <p>
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {!name && (
            <>
              {' · '}
              <button className="link-btn inline" onClick={onSetName}>
                Add your name
              </button>
            </>
          )}
        </p>
      </div>
      <div className="stats">
        {stats.map((s) => {
          const Icon = s.icon;
          const body = (
            <>
              <span className={`stat-icon tone-${s.tone}`}>
                <Icon size={16} aria-hidden />
              </span>
              <span className="stat-text">
                <span className={`stat-value ${s.key === 'overdue' && s.value > 0 ? 'danger' : ''}`}>{s.value}</span>
                <span className="stat-label">{s.label}</span>
              </span>
            </>
          );
          return s.onClick ? (
            <button
              key={s.key}
              className={`stat-card clickable ${s.active ? 'active' : ''}`}
              onClick={s.onClick}
              aria-pressed={s.active}
              title={s.active ? 'Show all tasks' : 'Show only overdue tasks'}
            >
              {body}
            </button>
          ) : (
            <div key={s.key} className="stat-card">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
