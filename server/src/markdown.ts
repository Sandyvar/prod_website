import { REPEATS, STATUSES, STATUS_LABELS, type Repeat, type Status, type Task } from '../../shared/types.js';

/**
 * TASKS.md format:
 *   # Tasks
 *   ## Active | ## Scheduled | ## Waiting On | ## Done
 *   - [ ] **Task title** - context, for whom, due date
 *   - [ ] **Task title** - scheduled 2026-11-13 10:00
 *   - [x] ~~Task~~ (date)
 * Repeating scheduled tasks add ", repeats weekly".
 */

export interface ParsedTask {
  title: string;
  notes: string;
  forPerson: string;
  dueDate: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  repeat: Repeat;
  status: Status;
  completedAt: string | null;
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ').trim();

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp — not the UTC date. */
const datePart = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function tasksToMarkdown(tasks: Task[]): string {
  const out: string[] = ['# Tasks', ''];
  for (const status of STATUSES) {
    out.push(`## ${STATUS_LABELS[status]}`);
    let inCol = tasks.filter((t) => t.status === status);
    inCol =
      status === 'scheduled'
        ? inCol.sort((a, b) => `${a.scheduledDate} ${a.scheduledTime ?? ''}`.localeCompare(`${b.scheduledDate} ${b.scheduledTime ?? ''}`))
        : inCol.sort((a, b) => a.position - b.position || b.id - a.id);
    for (const t of inCol) {
      const title = oneLine(t.title).replace(/\*\*/g, '').replace(/~~/g, '');
      if (status === 'done') {
        const date = datePart(t.completedAt);
        out.push(`- [x] ~~${title}~~${date ? ` (${date})` : ''}`);
        continue;
      }
      const details: string[] = [];
      // Commas separate fields, so commas inside notes become semicolons.
      if (t.notes.trim()) details.push(oneLine(t.notes).replace(/,/g, ';'));
      if (t.forPerson.trim()) details.push(`for ${oneLine(t.forPerson).replace(/,/g, ';')}`);
      if (t.dueDate) details.push(`due ${t.dueDate}`);
      if (t.scheduledDate && status === 'scheduled') details.push(`scheduled ${t.scheduledDate}${t.scheduledTime ? ` ${t.scheduledTime}` : ''}`);
      if (t.repeat !== 'none') details.push(`repeats ${t.repeat}`);
      out.push(`- [ ] **${title}**${details.length ? ` - ${details.join(', ')}` : ''}`);
    }
    out.push('');
  }
  return out.join('\n');
}

const SECTION_MAP: Record<string, Status> = {
  active: 'active',
  scheduled: 'scheduled',
  'waiting on': 'waiting',
  waiting: 'waiting',
  someday: 'active',
  done: 'done',
  completed: 'done',
};

const ITEM_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts "2026-11-10" or anything Date can parse ("Nov 10, 2026"); returns YYYY-MM-DD or null. */
function normaliseDate(s: string): string | null {
  const v = s.trim();
  if (ISO_DATE_RE.test(v)) return v;
  if (!/\d/.test(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function markdownToTasks(md: string): ParsedTask[] {
  const result: ParsedTask[] = [];
  let section: Status = 'active';
  for (const raw of md.split(/\r?\n/)) {
    const heading = raw.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = SECTION_MAP[heading[1].toLowerCase()] ?? section;
      continue;
    }
    const item = raw.match(ITEM_RE);
    if (!item) continue;
    const checked = item[1].toLowerCase() === 'x';
    let rest = item[2];

    let title = '';
    const m =
      rest.match(/^~~\*\*(.+?)\*\*~~/) ?? rest.match(/^\*\*~~(.+?)~~\*\*/) ?? rest.match(/^~~(.+?)~~/) ?? rest.match(/^\*\*(.+?)\*\*/);
    if (m) {
      title = m[1].trim();
      rest = rest.slice(m[0].length).trim();
    } else {
      const dash = rest.indexOf(' - ');
      title = (dash >= 0 ? rest.slice(0, dash) : rest).trim();
      rest = dash >= 0 ? rest.slice(dash).trim() : '';
    }
    if (!title) continue;

    let trailingDate: string | null = null;
    const paren = rest.match(/\(([^()]+)\)\s*$/);
    if (paren) {
      const d = normaliseDate(paren[1]);
      if (d) {
        trailingDate = d;
        rest = rest.slice(0, paren.index).trim();
      }
    }

    const notes: string[] = [];
    let forPerson = '';
    let dueDate: string | null = null;
    let scheduledDate: string | null = null;
    let scheduledTime: string | null = null;
    let repeat: Repeat = 'none';
    if (rest.startsWith('-')) rest = rest.replace(/^-+\s*/, '');
    if (rest) {
      for (const part of rest.split(/,\s*/)) {
        const p = part.trim();
        if (!p) continue;
        const forM = p.match(/^for\s+(.+)$/i);
        const dueM = p.match(/^due(?:\s+(?:on|by))?:?\s+(.+)$/i);
        const schM = p.match(/^scheduled:?\s+(\d{4}-\d{2}-\d{2})(?:\s+([01]\d|2[0-3]):([0-5]\d))?$/i);
        const repM = p.match(/^repeats?\s+(\w+)$/i);
        if (forM && !forPerson) forPerson = forM[1].trim();
        else if (dueM && !dueDate && normaliseDate(dueM[1])) dueDate = normaliseDate(dueM[1]);
        else if (schM && !scheduledDate && normaliseDate(schM[1])) {
          scheduledDate = schM[1];
          scheduledTime = schM[2] ? `${schM[2]}:${schM[3]}` : null;
        } else if (repM && (REPEATS as readonly string[]).includes(repM[1].toLowerCase())) repeat = repM[1].toLowerCase() as Repeat;
        else notes.push(p);
      }
    }

    let status: Status = checked || section === 'done' ? 'done' : section;
    // A scheduled task without a date can't live in Scheduled — fall back to Active.
    if (status === 'scheduled' && !scheduledDate) status = 'active';
    result.push({
      title: title.slice(0, 300),
      notes: notes.join(', '),
      forPerson: forPerson.slice(0, 200),
      dueDate: dueDate ?? (status !== 'done' ? trailingDate : null),
      scheduledDate,
      scheduledTime,
      repeat,
      status,
      completedAt: status === 'done' ? (trailingDate ? new Date(`${trailingDate}T12:00:00`).toISOString() : new Date().toISOString()) : null,
    });
  }
  return result;
}
