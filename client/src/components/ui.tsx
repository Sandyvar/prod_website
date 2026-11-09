import { CalendarDays, Columns3, List, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { Priority, Status, View } from '../../../shared/types';
import { avatarHue, initials, PRIORITY_LABEL } from '../utils';

export function Avatar({ name, size = 'md', title }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; title?: string }) {
  const hue = avatarHue(name);
  return (
    <span className={`avatar avatar-${size}`} style={{ ['--hue' as string]: hue }} title={title ?? name} aria-label={title ?? name} role="img">
      {initials(name)}
    </span>
  );
}

export function PriorityDot({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  return (
    <span className={`prio prio-${priority}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      <span className="prio-dot" aria-hidden />
      {withLabel ? PRIORITY_LABEL[priority] : <span className="sr-only">{PRIORITY_LABEL[priority]} priority</span>}
    </span>
  );
}

export const StatusDot = ({ status }: { status: Status }) => <span className={`status-dot dot-${status}`} aria-hidden />;

export function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={`Switch to ${dark ? 'light' : 'dark'} mode (D)`}
      className={`theme-toggle ${dark ? 'is-dark' : ''}`}
      onClick={onToggle}
    >
      <Sun size={14} className="tt-sun" aria-hidden />
      <Moon size={14} className="tt-moon" aria-hidden />
      <span className="tt-knob" aria-hidden />
    </button>
  );
}

const VIEW_META: Record<View, { label: string; icon: LucideIcon }> = {
  board: { label: 'Board', icon: Columns3 },
  list: { label: 'List', icon: List },
  calendar: { label: 'Calendar', icon: CalendarDays },
};

export function ViewToggle({ view, onChange, className }: { view: View; onChange: (v: View) => void; className?: string }) {
  return (
    <div className={`segmented view-toggle ${className ?? ''}`} role="radiogroup" aria-label="Task view">
      {(Object.keys(VIEW_META) as View[]).map((v) => {
        const { label, icon: Icon } = VIEW_META[v];
        return (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'active' : ''} onClick={() => onChange(v)} title={label}>
            <Icon size={15} aria-hidden />
            <span className="vt-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon: Icon, text, compact }: { icon: LucideIcon; text: string; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <span className="empty-icon">
        <Icon size={compact ? 18 : 22} aria-hidden />
      </span>
      <span>{text}</span>
    </div>
  );
}
