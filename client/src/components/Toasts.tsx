import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'error' | 'success' | 'info';
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}
interface ToastOptions {
  action?: ToastAction;
  duration?: number;
}

export interface ToastApi {
  error: (msg: string, opts?: ToastOptions) => void;
  success: (msg: string, opts?: ToastOptions) => void;
  info: (msg: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, message: string, opts: ToastOptions = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message, action: opts.action }]);
      setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 6000 : kind === 'error' ? 6000 : 3500));
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      error: (m, o) => push('error', m, o),
      success: (m, o) => push('success', m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <Icon size={16} className="toast-icon" aria-hidden />
              <span className="toast-msg">{t.message}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button className="icon-btn xs" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
