import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from './Drawer';

export interface ConfirmAction {
  key: string;
  label: string;
  variant?: 'primary' | 'danger' | 'secondary';
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  actions?: ConfirmAction[]; // defaults to a single "Confirm"
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<string | null>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: string | null) => void }) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);

  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <Modal {...state} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function Modal({ title, message, actions, onClose }: ConfirmOptions & { onClose: (v: string | null) => void }) {
  useEscape(() => onClose(null));
  const firstBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => firstBtn.current?.focus(), []);
  const list = actions ?? [{ key: 'confirm', label: 'Confirm', variant: 'primary' as const }];
  return createPortal(
    <div className="modal-root">
      <div className="drawer-backdrop" onClick={() => onClose(null)} />
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">{title}</h2>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          <button className="btn" onClick={() => onClose(null)}>
            Cancel
          </button>
          {list.map((a, i) => (
            <button
              key={a.key}
              ref={i === list.length - 1 ? firstBtn : undefined}
              className={`btn ${a.variant === 'danger' ? 'btn-danger' : a.variant === 'secondary' ? '' : 'btn-primary'}`}
              onClick={() => onClose(a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm outside ConfirmProvider');
  return ctx;
}
