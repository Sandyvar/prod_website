import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from '../../shared/types';
import { useData, type TaskInput } from './store';
import { useTheme } from './theme';
import { isTyping, todayStr, useLocalStorage } from './utils';
import { Header, type Tab } from './components/Header';
import { BottomBar } from './components/BottomBar';
import { TasksPage } from './components/TasksPage';
import { MemoryView } from './components/MemoryView';
import { SettingsView } from './components/SettingsView';
import { TaskPanel, type PanelTarget } from './components/TaskPanel';

export function App() {
  const { data, status, reload } = useData();
  const { theme, preference, setTheme, toggle } = useTheme();
  const [tab, setTab] = useLocalStorage<Tab>('tab', 'tasks');
  const [view, setViewState] = useState<View | null>(null); // null until settings load → defaultView
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);

  // Start on the default view from settings; switching views in the header is per-session.
  const settled = useRef(false);
  useEffect(() => {
    if (status === 'ready' && !settled.current) {
      settled.current = true;
      setViewState(data.settings.defaultView);
    }
  }, [status, data.settings.defaultView]);
  const currentView: View = view ?? data.settings.defaultView;

  const newTask = useCallback((draft: Partial<TaskInput> = {}) => setPanel({ draft }), []);
  const newOnDay = useCallback(
    (date: string) => newTask(date >= todayStr() ? { status: 'scheduled', scheduledDate: date } : { dueDate: date }),
    [newTask],
  );

  // Global shortcuts: N = new task, / = search, D = dark mode. Esc is handled by whichever panel is on top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (document.querySelector('.modal-root, .drawer-root')) {
        if (e.key.toLowerCase() === 'd') toggle();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        newTask();
      } else if (e.key === '/') {
        e.preventDefault();
        window.dispatchEvent(new Event('app:focus-search'));
      } else if (k === 'd') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newTask, toggle]);

  const goTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header
        tab={tab}
        setTab={goTab}
        view={currentView}
        setView={setViewState}
        theme={theme}
        toggleTheme={toggle}
        search={search}
        setSearch={setSearch}
        onNewTask={() => newTask()}
      />
      <main id="main" className="app-main">
        {status === 'loading' ? (
          <div className="loading">
            <div className="spinner" aria-label="Loading" />
          </div>
        ) : status === 'error' ? (
          <div className="loading">
            <p>Couldn’t reach the server.</p>
            <button className="btn btn-primary" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        ) : tab === 'tasks' ? (
          <TasksPage
            view={currentView}
            setView={setViewState}
            search={search}
            onOpenTask={(id) => setPanel({ id })}
            onNewOnDay={newOnDay}
            onSetName={() => goTab('settings')}
          />
        ) : tab === 'memory' ? (
          <MemoryView search={search} onOpenTask={(id) => setPanel({ id })} />
        ) : (
          <SettingsView preference={preference} setTheme={setTheme} />
        )}
      </main>
      <BottomBar tab={tab} setTab={goTab} onNewTask={() => newTask()} />
      {panel && <TaskPanel key={'id' in panel ? panel.id : 'new'} target={panel} onClose={closePanel} />}
    </div>
  );
}
