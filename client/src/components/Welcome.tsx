import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { useAuth, type AuthView } from '../auth';
import { Logo } from './Logo';

/** Always-dark sign-in / sign-up / guest screen with an animated background. */
export function Welcome() {
  const { upgrading, openUpgrade, user } = useAuth();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const resetToken = params.get('reset');
  const [view, setView] = useState<AuthView>(upgrading ?? (resetToken ? 'reset' : 'signin'));
  const [notice, setNotice] = useState<string | null>(params.get('auth_error'));
  const upgradeMode = !!upgrading && !!user?.isGuest;

  // Drop ?auth_error / ?reset from the address bar once read.
  useEffect(() => {
    if (params.has('auth_error') || params.has('reset')) history.replaceState(null, '', location.pathname);
  }, [params]);

  // The welcome screen is always dark — match the browser chrome.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute('content');
    meta?.setAttribute('content', '#131211');
    return () => {
      if (prev) meta?.setAttribute('content', prev);
    };
  }, []);

  const go = (v: AuthView) => {
    setNotice(null);
    setView(v);
  };

  return (
    <div className="welcome">
      <Backdrop />
      <main className="welcome-inner">
        {upgradeMode && (
          <button className="wl-back-app" onClick={() => openUpgrade(null)}>
            <ArrowLeft size={15} /> Back to the app
          </button>
        )}
        <div className="wl-brand">
          <Logo size={76} intro title="Productivity" />
          <h1>Productivity</h1>
          <p>Plan your day. Remember what matters.</p>
        </div>

        <section className="wl-card" aria-live="polite">
          {upgradeMode && (view === 'signin' || view === 'signup') && (
            <p className="wl-info">You’re using a guest account. {view === 'signup' ? 'Create an account' : 'Sign in'} and your tasks, notes and settings come with you.</p>
          )}
          {view === 'signin' || view === 'signup' ? (
            <>
              <Tabs view={view} onChange={go} />
              {notice && <Alert>{notice}</Alert>}
              {view === 'signin' ? <SignInForm onForgot={() => go('forgot')} /> : <SignUpForm />}
            </>
          ) : view === 'guest' ? (
            <GuestForm onBack={() => go('signin')} />
          ) : view === 'forgot' ? (
            <ForgotForm onBack={() => go('signin')} />
          ) : (
            <ResetForm token={resetToken ?? ''} onBack={() => go('signin')} />
          )}
        </section>

        {(view === 'signin' || view === 'signup') && !upgradeMode && (
          <button className="wl-guest" onClick={() => go('guest')}>
            Continue as guest
          </button>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- background
function Backdrop() {
  // Generated once per mount; purely decorative.
  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 1 + Math.random() * 1.8,
        delay: Math.random() * 6,
        dur: 2.5 + Math.random() * 4,
      })),
    [],
  );
  const rings = [
    { size: 420, top: '-8%', left: '-10%', dur: 26, delay: 0 },
    { size: 260, top: '62%', left: '-6%', dur: 21, delay: -6 },
    { size: 340, top: '8%', left: '74%', dur: 30, delay: -12 },
    { size: 180, top: '72%', left: '80%', dur: 19, delay: -3 },
    { size: 120, top: '38%', left: '12%', dur: 17, delay: -9 },
    { size: 90, top: '20%', left: '58%', dur: 15, delay: -4 },
  ];
  return (
    <div className="wl-backdrop" aria-hidden>
      {rings.map((r, i) => (
        <span
          key={i}
          className="wl-ring"
          style={{ width: r.size, height: r.size, top: r.top, left: r.left, animationDuration: `${r.dur}s`, animationDelay: `${r.delay}s` }}
        />
      ))}
      {stars.map((s) => (
        <span
          key={s.id}
          className="wl-star"
          style={{ top: `${s.top}%`, left: `${s.left}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pieces
function Tabs({ view, onChange }: { view: 'signin' | 'signup'; onChange: (v: AuthView) => void }) {
  return (
    <div className={`wl-tabs ${view === 'signup' ? 'right' : ''}`} role="tablist" aria-label="Account">
      <span className="wl-tab-highlight" aria-hidden />
      <button role="tab" aria-selected={view === 'signin'} onClick={() => onChange('signin')}>
        Sign in
      </button>
      <button role="tab" aria-selected={view === 'signup'} onClick={() => onChange('signup')}>
        Sign up
      </button>
    </div>
  );
}

function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  return (
    <div className={`wl-alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  autoFocus,
  placeholder,
  aside,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
  aside?: ReactNode;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="wl-field">
      <div className="wl-label-row">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="wl-input-wrap">
        <input
          id={id}
          className="wl-input"
          type={isPassword && show ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder={placeholder}
          required
          spellCheck={false}
        />
        {isPassword && (
          <button type="button" className="wl-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="wl-primary" disabled={busy}>
      {busy ? <Loader2 size={17} className="wl-spin" aria-label="Working" /> : children}
    </button>
  );
}

function GoogleButton() {
  const { googleEnabled, googleUrl } = useAuth();
  const [hint, setHint] = useState(false);
  return (
    <>
      <div className="wl-or" role="separator">
        <span>or</span>
      </div>
      <button
        type="button"
        className="wl-google"
        onClick={() => {
          if (googleEnabled) location.href = googleUrl;
          else setHint(true);
        }}
      >
        <GoogleG />
        Continue with Google
      </button>
      {hint && (
        <p className="wl-hint" role="status">
          Google sign-in isn’t set up yet. Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to <code>.env</code> and restart the server.
        </p>
      )}
    </>
  );
}

/** Hook for a form's busy/error state around an async action. */
function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    // Set on every mount (React dev mode mounts twice), cleared on unmount.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, onSubmit };
}

// ---------------------------------------------------------------- forms
function SignInForm({ onForgot }: { onForgot: () => void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(() => signIn(email, password));
  return (
    <form className="wl-form" onSubmit={onSubmit} noValidate={false}>
      {error && <Alert>{error}</Alert>}
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" autoFocus />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        aside={
          <button type="button" className="wl-link" onClick={onForgot}>
            Forgot password?
          </button>
        }
      />
      <Submit busy={busy}>Sign in</Submit>
      <GoogleButton />
    </form>
  );
}

function SignUpForm() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(() => signUp(name, email, password));
  const strength = password.length === 0 ? '' : password.length < 8 ? 'At least 8 characters' : password.length < 12 ? 'Good' : 'Strong';
  return (
    <form className="wl-form" onSubmit={onSubmit}>
      {error && <Alert>{error}</Alert>}
      <Field label="Full name" value={name} onChange={setName} autoComplete="name" placeholder="Jordan Lee" autoFocus />
      <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        aside={strength && <span className={`wl-strength ${password.length < 8 ? 'weak' : ''}`}>{strength}</span>}
      />
      <Submit busy={busy}>Create account</Submit>
      <GoogleButton />
    </form>
  );
}

function GuestForm({ onBack }: { onBack: () => void }) {
  const { continueAsGuest } = useAuth();
  const [name, setName] = useState('');
  const { busy, error, onSubmit } = useSubmit(() => continueAsGuest(name.trim()));
  return (
    <form className="wl-form wl-swap" onSubmit={onSubmit}>
      <h2 className="wl-title">What should we call you?</h2>
      <p className="wl-sub">Your tasks are saved on this device. You can move them into an account any time.</p>
      {error && <Alert>{error}</Alert>}
      <Field label="Your name" value={name} onChange={setName} autoComplete="given-name" placeholder="e.g. Sandy" autoFocus />
      <Submit busy={busy}>
        Let’s go <ArrowRight size={16} />
      </Submit>
      <button type="button" className="wl-link wl-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back to sign in
      </button>
    </form>
  );
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const { forgot } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await forgot(email);
    setSent(true);
  });
  return (
    <form className="wl-form wl-swap" onSubmit={onSubmit}>
      <h2 className="wl-title">Reset your password</h2>
      {sent ? (
        <Alert tone="success">
          <Mail size={15} /> If an account exists for <strong>{email}</strong>, a reset link was created. Email delivery isn’t configured for this app, so the link
          is printed in the <strong>server console</strong>. It works once, for 30 minutes.
        </Alert>
      ) : (
        <>
          <p className="wl-sub">Enter the email you signed up with and we’ll create a reset link.</p>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@example.com" autoFocus />
          <Submit busy={busy}>Create reset link</Submit>
        </>
      )}
      <button type="button" className="wl-link wl-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back to sign in
      </button>
    </form>
  );
}

function ResetForm({ token, onBack }: { token: string; onBack: () => void }) {
  const { reset } = useAuth();
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(() => reset(token, password));
  return (
    <form className="wl-form wl-swap" onSubmit={onSubmit}>
      <h2 className="wl-title">Choose a new password</h2>
      {error && <Alert>{error}</Alert>}
      <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
      <Submit busy={busy}>Save and sign in</Submit>
      <button type="button" className="wl-link wl-back" onClick={onBack}>
        <ArrowLeft size={14} /> Back to sign in
      </button>
    </form>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
