import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { useToast } from './components/Toasts';

export interface User {
  id: number;
  name: string;
  email: string | null;
  isGuest: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
}

export type AuthView = 'signin' | 'signup' | 'guest' | 'forgot' | 'reset';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  googleEnabled: boolean;
  /** A signed-in guest has opened the sign-in / sign-up screen to keep their data in an account. */
  upgrading: AuthView | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  continueAsGuest: (name: string) => Promise<void>;
  forgot: (email: string) => Promise<void>;
  reset: (token: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  openUpgrade: (view: AuthView | null) => void;
  googleUrl: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [upgrading, setUpgrading] = useState<AuthView | null>(null);

  useEffect(() => {
    void api
      .get<{ google: boolean }>('/api/auth/config')
      .then((c) => setGoogleEnabled(c.google))
      .catch(() => undefined);
    api
      .get<{ user: User | null }>('/api/auth/me')
      .then(({ user: u }) => {
        setUser(u);
        setStatus(u ? 'signedIn' : 'signedOut');
      })
      .catch(() => setStatus('signedOut'));
  }, []);

  // Any API call answering 401 means the session ended (expired, or signed out elsewhere).
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setStatus((s) => {
        if (s === 'signedIn') toast.info('Your session has ended — please sign in again');
        return 'signedOut';
      });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [toast]);

  const accept = useCallback(
    (u: User, keptGuestData?: boolean) => {
      setUser(u);
      setStatus('signedIn');
      setUpgrading(null);
      if (keptGuestData) toast.success('Your guest data is now saved in your account');
    },
    [toast],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<{ user: User; keptGuestData: boolean }>('/api/auth/login', { email, password });
      accept(r.user, r.keptGuestData);
    },
    [accept],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const r = await api.post<{ user: User; keptGuestData: boolean }>('/api/auth/signup', { name, email, password });
      accept(r.user, r.keptGuestData);
    },
    [accept],
  );

  const continueAsGuest = useCallback(
    async (name: string) => {
      const r = await api.post<{ user: User }>('/api/auth/guest', { name });
      accept(r.user);
    },
    [accept],
  );

  const forgot = useCallback(async (email: string) => {
    await api.post('/api/auth/forgot', { email });
  }, []);

  const reset = useCallback(
    async (token: string, password: string) => {
      const r = await api.post<{ user: User }>('/api/auth/reset', { token, password });
      accept(r.user);
      toast.success('Password updated — you’re signed in');
    },
    [accept, toast],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    setUser(null);
    setUpgrading(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      googleEnabled,
      upgrading,
      signIn,
      signUp,
      continueAsGuest,
      forgot,
      reset,
      signOut,
      openUpgrade: setUpgrading,
      googleUrl: '/api/auth/google',
    }),
    [status, user, googleEnabled, upgrading, signIn, signUp, continueAsGuest, forgot, reset, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
