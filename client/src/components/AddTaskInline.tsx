import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { REPEATS, type Priority, type Repeat, type Status } from '../../../shared/types';
import { useData, type TaskInput } from '../store';
import { dayFromToday } from '../utils';

/**
 * Quick-add syntax: "Call Sam about budget #finance !high @Sam"
 *   #tag → tag, !high/!medium/!low → priority, @Name → for person
 */
export function parseQuickAdd(raw: string): Omit<TaskInput, 'status'> {
  const tags: string[] = [];
  let priority: Priority | undefined;
  let forPerson = '';
  const title = raw
    .replace(/(^|\s)#([\w-]+)/g, (_, sp, t) => {
      tags.push(t.toLowerCase());
      return sp;
    })
    .replace(/(^|\s)!(high|medium|med|low)\b/gi, (_, sp, p) => {
      const v = p.toLowerCase();
      priority = v === 'med' ? 'medium' : (v as Priority);
      return sp;
    })
    .replace(/(^|\s)@([\w.-]+)/g, (_, sp, n) => {
      forPerson = n;
      return sp;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { title, tags, ...(priority ? { priority } : {}), ...(forPerson ? { forPerson } : {}) };
}

interface Props {
  status: Status;
  extra?: Partial<TaskInput>;
  placeholder?: string;
  label?: string;
}

/** "+ Add a task" at the bottom of a column. In Scheduled it also asks for a date (required) and optional time/repeat. */
export function AddTaskInline({ status, extra, placeholder, label = 'Add a task' }: Props) {
  const { createTask, peopleById } = useData();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [date, setDate] = useState(dayFromToday(1));
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();
  const scheduled = status === 'scheduled';

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    const parsed = parseQuickAdd(value);
    if (!parsed.title || (scheduled && !date)) return;
    let personId: number | undefined;
    if (parsed.forPerson) {
      const want = parsed.forPerson.toLowerCase();
      for (const p of peopleById.values()) if (p.nickname.toLowerCase() === want) personId = p.id;
    }
    void createTask({
      ...parsed,
      ...(personId ? { personId } : {}),
      ...(scheduled ? { scheduledDate: date, scheduledTime: time || null, repeat } : {}),
      ...extra,
      status,
    });
    setValue('');
    inputRef.current?.focus();
  };

  const close = () => {
    setValue('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="add-task-btn" onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden /> {label}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      className="add-task-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        // Close when focus leaves the whole form and nothing was typed.
        if (!formRef.current?.contains(e.relatedTarget as Node) && !value.trim()) setOpen(false);
      }}
    >
      <input
        ref={inputRef}
        className="input bare"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? 'Task title  #tag  !high  @person'}
        aria-label="New task title"
      />
      {scheduled && (
        <div className="add-task-schedule">
          <label htmlFor={`${ids}-d`} className="sr-only">
            Scheduled date
          </label>
          <input id={`${ids}-d`} type="date" className="input sm" required value={date} onChange={(e) => setDate(e.target.value)} />
          <label htmlFor={`${ids}-t`} className="sr-only">
            Time (optional)
          </label>
          <input id={`${ids}-t`} type="time" className="input sm" value={time} onChange={(e) => setTime(e.target.value)} />
          <label htmlFor={`${ids}-r`} className="sr-only">
            Repeat
          </label>
          <select id={`${ids}-r`} className="select sm" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {r === 'none' ? 'No repeat' : r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="add-task-actions">
        <span className="hint">Enter to add · Esc to close</span>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!value.trim() || (scheduled && !date)}>
          Add
        </button>
      </div>
    </form>
  );
}
