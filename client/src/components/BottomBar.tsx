import { Brain, ListChecks, Plus, Settings } from 'lucide-react';
import type { Tab } from './Header';

/** Phone-only navigation (hidden on larger screens via CSS). */
export function BottomBar({ tab, setTab, onNewTask }: { tab: Tab; setTab: (t: Tab) => void; onNewTask: () => void }) {
  const item = (t: Tab, label: string, Icon: typeof Brain) => (
    <button className={tab === t ? 'active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
      <Icon size={20} aria-hidden />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="bottom-bar" aria-label="Main">
      {item('tasks', 'Tasks', ListChecks)}
      <button className="bb-new" onClick={onNewTask} aria-label="New task">
        <Plus size={22} strokeWidth={2.4} aria-hidden />
      </button>
      {item('memory', 'Memory', Brain)}
      {item('settings', 'Settings', Settings)}
    </nav>
  );
}
