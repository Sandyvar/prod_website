import { useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { X as IconX } from 'lucide-react';

/**
 * Local text state that autosaves after a short pause, on blur, and on unmount
 * (so closing a panel with Esc never loses typing).
 */
function useAutosave(value: string, onSave: (v: string) => void, opts: { delay?: number; required?: boolean } = {}) {
  const { delay = 600, required = false } = opts;
  const [local, setLocal] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const lastSaved = useRef(value);

  useEffect(() => {
    if (pending.current === null) {
      setLocal(value);
      lastSaved.current = value;
    }
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const v = pending.current;
    pending.current = null;
    if (v === null) return;
    if (required && !v.trim()) return;
    if (v.trim() === lastSaved.current.trim()) return;
    lastSaved.current = v;
    saveRef.current(v);
  }, [required]);

  const change = (v: string) => {
    setLocal(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  const blur = () => {
    flush();
    if (required && !local.trim()) setLocal(lastSaved.current);
  };

  useEffect(() => () => flush(), [flush]);
  return { local, change, blur };
}

interface AutoProps {
  label?: string;
  value: string;
  onSave: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function AutoInput({ label, value, onSave, required, type = 'text', list, ...rest }: AutoProps & { type?: string; list?: string }) {
  const { local, change, blur } = useAutosave(value, onSave, { required });
  const id = useId();
  const input = (
    <input
      id={id}
      type={type}
      list={list}
      value={local}
      onChange={(e) => change(e.target.value)}
      onBlur={blur}
      aria-label={label ? undefined : rest.placeholder}
      className={`input ${rest.className ?? ''}`}
      placeholder={rest.placeholder}
      autoFocus={rest.autoFocus}
    />
  );
  return label ? <Field label={label} htmlFor={id}>{input}</Field> : input;
}

export function AutoTextarea({ label, value, onSave, rows = 4, ...rest }: AutoProps & { rows?: number }) {
  const { local, change, blur } = useAutosave(value, onSave);
  const id = useId();
  const el = (
    <textarea
      id={id}
      rows={rows}
      value={local}
      onChange={(e) => change(e.target.value)}
      onBlur={blur}
      className={`input textarea ${rest.className ?? ''}`}
      placeholder={rest.placeholder}
    />
  );
  return label ? <Field label={label} htmlFor={id}>{el}</Field> : el;
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function TextInput({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} className="input" {...props} />
    </Field>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TagsInput({ value, onChange, suggestions }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);
    const next = [...new Set([...value, ...parts])];
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="tags-input">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>
            <IconX width={12} height={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={value.length ? 'Add tag…' : 'Add tags (Enter to add)'}
        aria-label="Add tag"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
