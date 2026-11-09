import { useRef } from 'react';
import { Database, Download, FileText, Keyboard, LogOut, Monitor, Moon, Palette, Sun, Upload, User, UserPlus } from 'lucide-react';
import { useAuth } from '../auth';
import { VIEWS, type View } from '../../../shared/types';
import { api } from '../api';
import { useData } from '../store';
import type { Theme } from '../theme';
import { downloadFile } from '../utils';
import { useConfirm } from './Confirm';
import { AutoInput, Field, Segmented } from './fields';
import { useToast } from './Toasts';

interface Props {
  preference: Theme | null;
  setTheme: (t: Theme | null) => void;
}

const SHORTCUTS: [string, string][] = [
  ['N', 'New task'],
  ['/', 'Search'],
  ['D', 'Toggle dark mode'],
  ['Esc', 'Close panel or dialog'],
  ['Enter', 'Open the focused card'],
  ['Space', 'Pick up / drop a focused card'],
];

export function SettingsView({ preference, setTheme }: Props) {
  const { data, updateSettings, reload } = useData();
  const { user, signOut, openUpgrade } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const onSignOut = async () => {
    if (user?.isGuest) {
      const choice = await confirm({
        title: 'Sign out of guest mode?',
        message: 'Guest data is tied to this sign-in. Once you sign out you can’t get back to it — create an account first to keep it.',
        actions: [
          { key: 'signout', label: 'Sign out anyway', variant: 'danger' },
          { key: 'create', label: 'Create account', variant: 'primary' },
        ],
      });
      if (choice === 'create') openUpgrade('signup');
      if (choice !== 'signout') return;
    }
    await signOut();
  };
  const mdInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const importMarkdown = async (file: File) => {
    const markdown = await file.text();
    const count = (markdown.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? []).length;
    if (count === 0) {
      toast.error(`No tasks found in ${file.name}. Expected lines like "- [ ] **Task**".`);
      return;
    }
    const mode = await confirm({
      title: 'Import TASKS.md',
      message: (
        <>
          Found <strong>{count}</strong> task{count === 1 ? '' : 's'} in <code>{file.name}</code>. Add them to your existing tasks, or replace all current tasks?
        </>
      ),
      actions: [
        { key: 'replace', label: 'Replace all tasks', variant: 'danger' },
        { key: 'append', label: 'Add to existing', variant: 'primary' },
      ],
    });
    if (!mode) return;
    try {
      const res = await api.post<{ imported: number }>('/api/import/markdown', { markdown, mode });
      await reload();
      toast.success(`Imported ${res.imported} task${res.imported === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  };

  const restoreJson = async (file: File) => {
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      toast.error(`${file.name} isn't valid JSON`);
      return;
    }
    const ok = await confirm({
      title: 'Restore from backup?',
      message: (
        <>
          This <strong>replaces everything</strong> — tasks, people, projects, glossary, notes and settings — with the contents of <code>{file.name}</code>. Consider
          exporting a backup first.
        </>
      ),
      actions: [{ key: 'restore', label: 'Replace all data', variant: 'danger' }],
    });
    if (!ok) return;
    try {
      const res = await api.post<{ restored: Record<string, number> }>('/api/import/json', backup);
      await reload();
      const r = res.restored;
      toast.success(`Restored ${r.tasks} tasks, ${r.people} people, ${r.projects} projects, ${r.glossary} terms, ${r.notes} notes`);
    } catch (e) {
      toast.error(`Restore failed: ${(e as Error).message}`);
    }
  };

  const onFile = (handler: (f: File) => Promise<void>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void handler(f);
  };

  return (
    <div className="settings">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="muted">Saved to your local database as you change them.</p>
      </header>

      <section className="settings-card">
        <h2>
          <User size={17} aria-hidden /> Account
        </h2>
        <AutoInput label="Your name" value={data.settings.name} required onSave={(name) => void updateSettings({ name: name.trim() })} placeholder="Used in the greeting" />
        <div className="data-row account-row">
          <div>
            <h3>{user?.isGuest ? 'Guest on this device' : user?.email}</h3>
            <p className="muted small">
              {user?.isGuest
                ? 'Your data is saved on this device only. Create an account (or sign in) to keep it and use it anywhere.'
                : [user?.hasPassword && 'Email & password', user?.hasGoogle && 'Google'].filter(Boolean).join(' · ') || 'Signed in'}
            </p>
          </div>
          <div className="data-actions">
            {user?.isGuest && (
              <>
                <button className="btn btn-primary" onClick={() => openUpgrade('signup')}>
                  <UserPlus size={15} /> Create account
                </button>
                <button className="btn" onClick={() => openUpgrade('signin')}>
                  Sign in
                </button>
              </>
            )}
            <button className="btn" onClick={() => void onSignOut()}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h2>
          <Palette size={17} aria-hidden /> Appearance
        </h2>
        <Field label="Theme">
          <Segmented<'light' | 'dark' | 'system'>
            label="Theme"
            value={preference ?? 'system'}
            options={[
              { value: 'light', label: <><Sun size={14} /> Light</> },
              { value: 'dark', label: <><Moon size={14} /> Dark</> },
              { value: 'system', label: <><Monitor size={14} /> System</> },
            ]}
            onChange={(v) => setTheme(v === 'system' ? null : v)}
          />
        </Field>
        <Field label="Default task view">
          <Segmented<View>
            label="Default task view"
            value={data.settings.defaultView}
            options={VIEWS.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
            onChange={(defaultView) => void updateSettings({ defaultView })}
          />
        </Field>
      </section>

      <section className="settings-card">
        <h2>
          <Database size={17} aria-hidden /> Data
        </h2>
        <div className="data-row">
          <div>
            <h3>
              <FileText size={15} aria-hidden /> TASKS.md
            </h3>
            <p className="muted small">Plain-text task list with Active, Scheduled, Waiting On and Done sections.</p>
          </div>
          <div className="data-actions">
            <button className="btn" onClick={() => downloadFile('/api/export/markdown')}>
              <Download size={15} /> Export
            </button>
            <button className="btn" onClick={() => mdInput.current?.click()}>
              <Upload size={15} /> Import…
            </button>
          </div>
        </div>
        <div className="data-row">
          <div>
            <h3>
              <Database size={15} aria-hidden /> Full backup (JSON)
            </h3>
            <p className="muted small">Everything — tasks, memory and settings. Restoring replaces all current data.</p>
          </div>
          <div className="data-actions">
            <button className="btn btn-primary" onClick={() => downloadFile('/api/export/json')}>
              <Download size={15} /> Export backup
            </button>
            <button className="btn" onClick={() => jsonInput.current?.click()}>
              <Upload size={15} /> Restore…
            </button>
          </div>
        </div>
        <input ref={mdInput} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={onFile(importMarkdown)} />
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={onFile(restoreJson)} />
      </section>

      <section className="settings-card">
        <h2>
          <Keyboard size={17} aria-hidden /> Keyboard shortcuts
        </h2>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
