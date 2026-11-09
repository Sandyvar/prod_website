import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X as IconX } from 'lucide-react';

// Stack of Escape handlers: only the top-most overlay closes on Esc.
const escStack: Array<{ current: () => void }> = [];
let listening = false;
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || escStack.length === 0) return;
  e.preventDefault();
  escStack[escStack.length - 1].current();
}

export function useEscape(handler: () => void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    if (!listening) {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    const entry = { get current() { return ref.current; } };
    escStack.push(entry);
    return () => {
      const i = escStack.indexOf(entry);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [active]);
}

interface DrawerProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  label: string;
}

export function Drawer({ title, onClose, children, footer, wide, label }: DrawerProps) {
  useEscape(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  return createPortal(
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <div ref={panelRef} className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="drawer-header">
          <div className="drawer-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
            <IconX width={18} height={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
