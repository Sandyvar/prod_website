import { useEffect, useState } from 'react';
import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  isSameYear,
  parse,
  parseISO,
  startOfWeek,
} from 'date-fns';
import type { Person, Priority, Task } from '../../shared/types';

/** Weeks start on Monday everywhere in the app. */
export const WEEK_OPTS = { weekStartsOn: 1 as const };

// ---------- Dates (always the browser's local time) ----------
export const toDateStr = (d: Date) => format(d, 'yyyy-MM-dd');
export const todayStr = () => toDateStr(new Date());
export const dayFromToday = (n: number) => toDateStr(addDays(new Date(), n));
/** "2026-11-10" → local midnight Date. */
export const parseDay = (ymd: string) => parseISO(ymd);

export function formatDay(ymd: string): string {
  const d = parseDay(ymd);
  const diff = differenceInCalendarDays(d, new Date());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return format(d, isSameYear(d, new Date()) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
}

/** "Today" → "today" (for use mid-sentence); real dates unchanged. */
export const lowerRelative = (s: string) => (/^(Today|Tomorrow|Yesterday)$/.test(s) ? s.toLowerCase() : s);

/** "Nov 9" (adds the year only when it isn't this year). */
export function formatShort(iso: string): string {
  const d = new Date(iso);
  return format(d, isSameYear(d, new Date()) ? 'MMM d' : 'MMM d, yyyy');
}

export const formatTime = (hhmm: string) => format(parse(hhmm, 'HH:mm', new Date()), 'h:mm a');

/** "Thu, Nov 13 · 10:00 AM" */
export function formatSchedule(t: Pick<Task, 'scheduledDate' | 'scheduledTime'>): string {
  if (!t.scheduledDate) return '';
  const d = parseDay(t.scheduledDate);
  const day = format(d, isSameYear(d, new Date()) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
  return t.scheduledTime ? `${day} · ${formatTime(t.scheduledTime)}` : day;
}

export function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return '';
  return format(new Date(iso), withTime ? 'MMM d, yyyy · h:mm a' : 'MMM d, yyyy');
}

export function daysSince(iso: string): number {
  return Math.max(0, differenceInCalendarDays(new Date(), new Date(iso)));
}

export const waitingLabel = (days: number) => (days === 0 ? 'Waiting since today' : `Waiting ${days} day${days === 1 ? '' : 's'}`);

export type DueState = 'overdue' | 'today' | null;
export function dueState(t: Pick<Task, 'dueDate' | 'status'>): DueState {
  if (!t.dueDate || t.status === 'done') return null;
  const today = todayStr();
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  return null;
}

export function isThisWeek(ymd: string | null): boolean {
  if (!ymd) return false;
  const d = parseDay(ymd);
  const now = new Date();
  return d >= startOfWeek(now, WEEK_OPTS) && d <= endOfWeek(now, WEEK_OPTS);
}

export type ScheduleGroup = 'Today' | 'Tomorrow' | 'This week' | 'Later';
export function scheduleGroup(ymd: string): ScheduleGroup {
  const diff = differenceInCalendarDays(parseDay(ymd), new Date());
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (parseDay(ymd) <= endOfWeek(new Date(), WEEK_OPTS)) return 'This week';
  return 'Later';
}

/** Tasks that belong to today: due today or earlier, or scheduled for today or earlier. */
export function isForToday(t: Task): boolean {
  if (t.status === 'done') return false;
  const today = todayStr();
  return (!!t.dueDate && t.dueDate <= today) || (!!t.scheduledDate && t.scheduledDate <= today && t.status !== 'waiting');
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---------- Tasks ----------
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const byPosition = (a: Task, b: Task) => a.position - b.position || a.id - b.id;
export const bySchedule = (a: Task, b: Task) =>
  `${a.scheduledDate ?? '9999'} ${a.scheduledTime ?? '99:99'}`.localeCompare(`${b.scheduledDate ?? '9999'} ${b.scheduledTime ?? '99:99'}`) || byPosition(a, b);

export interface TaskFilters {
  tag: string;
  priority: '' | Priority;
  person: string;
  overdue: boolean;
  thisWeek: boolean;
}
export const EMPTY_FILTERS: TaskFilters = { tag: '', priority: '', person: '', overdue: false, thisWeek: false };
export const hasFilters = (f: TaskFilters, search = '') => !!(search || f.tag || f.priority || f.person || f.overdue || f.thisWeek);

export function taskPersonName(t: Task, peopleById: Map<number, Person>): string {
  if (t.personId && peopleById.has(t.personId)) return peopleById.get(t.personId)!.nickname;
  return t.forPerson;
}

export function matchesFilters(t: Task, f: TaskFilters, search: string, peopleById: Map<number, Person>): boolean {
  if (f.tag && !t.tags.includes(f.tag)) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.overdue && dueState(t) !== 'overdue') return false;
  if (f.thisWeek && !isThisWeek(t.dueDate) && !isThisWeek(t.scheduledDate)) return false;
  if (f.person) {
    const want = f.person.toLowerCase();
    const linked = t.personId ? peopleById.get(t.personId) : undefined;
    const names = [t.forPerson, linked?.nickname, linked?.fullName].filter(Boolean).map((s) => s!.toLowerCase());
    if (!names.includes(want)) return false;
  }
  if (search) {
    const linked = t.personId ? (peopleById.get(t.personId)?.nickname ?? '') : '';
    const hay = [t.title, t.notes, t.forPerson, linked, ...t.tags.map((x) => `#${x}`)].join(' ').toLowerCase();
    if (!search.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

// ---------- Misc ----------
export function useLocalStorage<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* storage unavailable */
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Stable soft hue for a person's avatar. */
export function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function downloadFile(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;
