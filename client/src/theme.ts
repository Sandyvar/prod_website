import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from './store';

export type Theme = 'light' | 'dark';
const KEY = 'theme';

const systemTheme = (): Theme => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)?.replace(/"/g, '');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(t: Theme | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Applies a theme with a short cross-fade (only while switching, so hovers stay snappy). */
function apply(t: Theme, animate: boolean) {
  const root = document.documentElement;
  if (animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-fade');
    window.setTimeout(() => root.classList.remove('theme-fade'), 260);
  }
  root.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#1a1918' : '#faf9f5');
}

/**
 * Theme resolution:
 *  1. explicit choice saved in the database settings (synced across browsers)
 *  2. explicit choice cached in localStorage (instant, avoids a flash before the API answers)
 *  3. the OS setting (prefers-color-scheme) — first visit
 */
export function useTheme() {
  const { data, status, updateSettings } = useData();
  const [preference, setPreference] = useState<Theme | null>(readStored);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const synced = useRef(false);

  // Follow OS changes while no explicit preference is set.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Once settings load, the database value wins (once).
  useEffect(() => {
    if (status !== 'ready' || synced.current) return;
    synced.current = true;
    const dbTheme = data.settings.theme;
    if (dbTheme !== null && dbTheme !== preference) {
      setPreference(dbTheme);
      writeStored(dbTheme);
    } else if (dbTheme === null && preference !== null) {
      // Chosen in this browser before the DB knew about it — push it up.
      void updateSettings({ theme: preference });
    }
  }, [status, data.settings.theme, preference, updateSettings]);

  const theme: Theme = preference ?? system;
  const first = useRef(true);
  useEffect(() => {
    apply(theme, !first.current);
    first.current = false;
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme | null) => {
      setPreference(t);
      writeStored(t);
      void updateSettings({ theme: t });
    },
    [updateSettings],
  );

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  return { theme, preference, setTheme, toggle };
}
