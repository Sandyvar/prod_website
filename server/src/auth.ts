import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, RequestHandler, Response } from 'express';
import type { DB } from './db.js';
import { HttpError } from './repo.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string | null;
  isGuest: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/** The signed-in user's id (only call after requireUser). */
export const uid = (req: Request) => req.user!.id;

// ---------- Passwords ----------
const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);
export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
/** Compared against when the email doesn't exist, so response time doesn't reveal which emails are registered. */
let dummyHash: Promise<string> | null = null;
export const dummyCheck = async (pw: string) => {
  dummyHash ??= bcrypt.hash('not-a-real-password', ROUNDS);
  await bcrypt.compare(pw, await dummyHash);
  return false;
};

// ---------- Tokens ----------
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Cookies ----------
export const SESSION_COOKIE = 'sid';
const DAY = 86400_000;
export const SESSION_TTL = { user: 30 * DAY, guest: 365 * DAY };

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Secure cookies need HTTPS: on when APP_URL is https (or COOKIE_SECURE=true). */
const secureCookies = () => process.env.COOKIE_SECURE === 'true' || (process.env.APP_URL || '').startsWith('https://');

export function setCookie(res: Response, name: string, value: string, maxAgeMs: number) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secureCookies()) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
export const clearCookie = (res: Response, name: string) => setCookie(res, name, '', 0);

// ---------- Sessions ----------
export function createSession(db: DB, res: Response, userId: number, isGuest: boolean) {
  const token = newToken();
  const ttl = isGuest ? SESSION_TTL.guest : SESSION_TTL.user;
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + ttl).toISOString(),
  );
  setCookie(res, SESSION_COOKIE, token, ttl);
}

export function destroySession(db: DB, req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  clearCookie(res, SESSION_COOKIE);
}

export function toAuthUser(row: Record<string, any>): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    isGuest: !!row.is_guest,
    hasPassword: !!row.password_hash,
    hasGoogle: !!row.google_sub,
  };
}

export function getUser(db: DB, id: number): AuthUser {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!row) throw new HttpError(404, 'User not found');
  return toAuthUser(row);
}

/** Reads the session cookie (if any) and attaches req.user. Never fails the request. */
export const loadUser =
  (db: DB): RequestHandler =>
  (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const row = db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(sha256(token), new Date().toISOString()) as Record<string, any> | undefined;
      if (row) req.user = toAuthUser(row);
    }
    next();
  };

export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in' });
    return;
  }
  next();
};

/** Deletes expired sessions and reset tokens (run at startup and daily). */
export function pruneExpired(db: DB) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now);
}

/**
 * Rejects cross-site writes: if the browser sends an Origin header on a state-changing request,
 * its host must match the host it was sent to. (SameSite=Lax cookies already block most CSRF;
 * this is defence in depth.)
 */
export const sameOrigin: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    /* malformed */
  }
  const allowed = new Set([req.get('host'), req.get('x-forwarded-host')]);
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  } catch {
    /* bad APP_URL */
  }
  if (originHost && allowed.has(originHost)) return next();
  res.status(403).json({ error: 'Cross-site request blocked' });
};

// ---------- Rate limiting (in memory, per IP + key) ----------
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    entry.count++;
    return entry.count <= max;
  };
}

// ---------- Google OAuth (authorization code flow) ----------
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const appUrl = (process.env.APP_URL || defaultAppUrl()).replace(/\/$/, '');
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/auth/google/callback` };
}

export const defaultAppUrl = () =>
  process.env.NODE_ENV === 'production' ? `http://localhost:${process.env.PORT ?? 3001}` : 'http://localhost:5173';

export function googleAuthUrl(cfg: GoogleConfig, state: string) {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}

/** Exchanges the code for tokens, then reads the profile from Google's userinfo endpoint over TLS. */
export async function googleProfile(cfg: GoogleConfig, code: string): Promise<GoogleProfile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error('Google did not return an access token');
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new Error(`Google profile request failed (${infoRes.status})`);
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub) throw new Error('Google profile has no subject id');
  return { sub: info.sub, email: info.email ?? null, emailVerified: !!info.email_verified, name: info.name ?? '' };
}
