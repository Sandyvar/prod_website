import { useEffect, useRef } from 'react';
import { Plus, Search, Settings, X } from 'lucide-react';
import { Logo } from './Logo';
import type { View } from '../../../shared/types';
import { ThemeToggle, ViewToggle } from './ui';

export type Tab = 'tasks' | 'memory' | 'settings';

interface Props {
  tab: Tab;
  setTab: (t: Tab) => void;
  view: View;
  setView: (v: View) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  search: string;
  setSearch: (s: string) => void;
  onNewTask: () => void;
}

export function Header({ tab, setTab, view, setView, theme, toggleTheme, search, setSearch, onNewTask }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('app:focus-search', focus);
    return () => window.removeEventListener('app:focus-search', focus);
  }, []);

  return (
    <header className="app-header">
      <div className="header-inner">
        <button className="brand" onClick={() => setTab('tasks')} aria-label="Productivity — go to Tasks">
          <Logo size={34} className="logo-header" />
          <span className="brand-name">Productivity</span>
        </button>

        <nav className="tabs" role="tablist" aria-label="Sections">
          {(['tasks', 'memory'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'tasks' ? 'Tasks' : 'Memory'}
            </button>
          ))}
        </nav>

        <div className="header-search">
          <Search size={15} className="search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder={tab === 'memory' ? 'Search memory' : 'Search tasks'}
            aria-label={tab === 'memory' ? 'Search memory' : 'Search tasks'}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (tab === 'settings') setTab('tasks');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (search) setSearch('');
                else e.currentTarget.blur();
              }
            }}
          />
          {search ? (
            <button className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : (
            <kbd className="search-kbd" aria-hidden>
              /
            </kbd>
          )}
        </div>

        <div className="header-actions">
          {tab === 'tasks' && <ViewToggle view={view} onChange={setView} className="header-view" />}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button
            className={`icon-btn header-settings ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
            aria-label="Settings"
            aria-current={tab === 'settings' ? 'page' : undefined}
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <button className="btn btn-primary new-task-btn" onClick={onNewTask} title="New task (N)">
            <Plus size={16} strokeWidth={2.4} />
            <span>New task</span>
          </button>
        </div>
      </div>
    </header>
  );
}
