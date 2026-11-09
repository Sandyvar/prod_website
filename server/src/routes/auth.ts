import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { claimOrphans, moveUserData, seedUser, type DB } from '../db.js';
import {
  checkPassword,
  clearCookie,
  createSession,
  destroySession,
  dummyCheck,
  getUser,
  googleAuthUrl,
  googleConfig,
  googleProfile,
  hashPassword,
  newToken,
  parseCookies,
  rateLimiter,
  setCookie,
  sha256,

  type GoogleProfile,
} from '../auth.js';
import { HttpError } from '../repo.js';

const name = z.string().trim().min(1, 'Please enter your name').max(80);
const email = z.string().trim().toLowerCase().email('Please enter a valid email').max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);

const signupBody = z.object({ name, email, password });
const loginBody = z.object({ email, password: z.string().min(1, 'Please enter your password').max(200) });
const guestBody = z.object({ name });
const forgotBody = z.object({ email });
const resetBody = z.object({ token: z.string().min(10).max(200), password });
const profileBody = z.object({ name });

interface Options {
  /** Give new users the example tasks (off in most tests). */
  seedNewUsers: boolean;
}

export function authRouter(db: DB, opts: Options) {
  const r = Router();
  const loginLimit = rateLimiter(10, 15 * 60_000);
  const resetLimit = rateLimiter(5, 15 * 60_000);
  const ip = (req: Request) => req.ip ?? 'unknown';

  const userRow = (where: string, value: unknown) => db.prepare(`SELECT * FROM users WHERE ${where}`).get(value) as Record<string, any> | undefined;

  /** Creates a user; the very first user also inherits data from before accounts existed. */
  const createUser = (fields: { name: string; email?: string | null; passwordHash?: string | null; googleSub?: string | null; isGuest: boolean }) => {
    const info = db
      .prepare(`INSERT INTO users (name, email, password_hash, google_sub, is_guest, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(fields.name, fields.email ?? null, fields.passwordHash ?? null, fields.googleSub ?? null, fields.isGuest ? 1 : 0, new Date().toISOString());
    const id = Number(info.lastInsertRowid);
    const claimed = claimOrphans(db, id);
    if (!claimed && opts.seedNewUsers) seedUser(db, id);
    return id;
  };

  /** Starts a fresh session for `userId`, replacing whatever session the request had. */
  const signIn = (req: Request, res: Response, userId: number) => {
    destroySession(db, req, res);
    const u = getUser(db, userId);
    createSession(db, res, userId, u.isGuest);
    return u;
  };

  /** If a guest is signed in, move their data into `accountId` and delete the guest. */
  const absorbGuest = (req: Request, accountId: number) => {
    const g = req.user;
    if (!g?.isGuest || g.id === accountId) return false;
    db.transaction(() => {
      moveUserData(db, g.id, accountId);
      const account = getUser(db, accountId);
      if (!account.name && g.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(g.name, accountId);
      db.prepare('DELETE FROM users WHERE id = ?').run(g.id);
    })();
    return true;
  };

  r.get('/config', (_req, res) => {
    res.json({ google: !!googleConfig() });
  });

  // "Not signed in" is a normal answer here, not an error.
  r.get('/me', (req, res) => {
    res.json({ user: req.user ?? null });
  });

  r.put('/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Please sign in');
    const { name: n } = profileBody.parse(req.body);
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, req.user.id);
    res.json({ user: getUser(db, req.user.id) });
  });

  r.post('/signup', async (req, res) => {
    const body = signupBody.parse(req.body);
    if (userRow('email = ?', body.email)) throw new HttpError(409, 'An account with this email already exists — try signing in');
    const passwordHash = await hashPassword(body.password);
    let id: number;
    if (req.user?.isGuest) {
      // Upgrade the guest in place: same id, so all their data comes along.
      id = req.user.id;
      db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, is_guest = 0 WHERE id = ?').run(body.name, body.email, passwordHash, id);
    } else {
      id = createUser({ name: body.name, email: body.email, passwordHash, isGuest: false });
    }
    res.status(201).json({ user: signIn(req, res, id), keptGuestData: !!req.user?.isGuest });
  });

  r.post('/login', async (req, res) => {
    const body = loginBody.parse(req.body);
    if (!loginLimit(`${ip(req)}|${body.email}`)) throw new HttpError(429, 'Too many attempts — please wait a few minutes and try again');
    const row = userRow('email = ?', body.email);
    const ok = row?.password_hash ? await checkPassword(body.password, row.password_hash) : await dummyCheck(body.password);
    if (!row || !ok) throw new HttpError(401, 'Email or password is incorrect');
    const merged = absorbGuest(req, row.id);
    res.json({ user: signIn(req, res, row.id), keptGuestData: merged });
  });

  r.post('/guest', (req, res) => {
    const body = guestBody.parse(req.body);
    const id = createUser({ name: body.name, isGuest: true });
    res.status(201).json({ user: signIn(req, res, id) });
  });

  r.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  /**
   * Creates a password-reset link. There is no email service configured, so the link is printed in
   * the server console; the response says so. It never reveals whether the email has an account.
   */
  r.post('/forgot', (req, res) => {
    const body = forgotBody.parse(req.body);
    if (!resetLimit(`${ip(req)}|${body.email}`)) throw new HttpError(429, 'Too many requests — please wait a few minutes');
    const row = userRow('email = ?', body.email);
    if (row && !row.is_guest) {
      const token = newToken();
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.id);
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        sha256(token),
        row.id,
        new Date(Date.now() + 30 * 60_000).toISOString(),
      );
      const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      console.log(`\n[password reset] ${body.email}: ${base}/?reset=${token}  (valid for 30 minutes)\n`);
    }
    res.json({ ok: true, delivery: 'console' });
  });

  r.post('/reset', async (req, res) => {
    const body = resetBody.parse(req.body);
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?').get(sha256(body.token), new Date().toISOString()) as
      | { user_id: number }
      | undefined;
    if (!row) throw new HttpError(400, 'This reset link is invalid or has expired — request a new one');
    const hash = await hashPassword(body.password);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id); // sign out everywhere
    })();
    res.json({ user: signIn(req, res, row.user_id) });
  });

  // ---------- Google ----------
  r.get('/google', (_req, res) => {
    const cfg = googleConfig();
    if (!cfg) {
      res.redirect('/?auth_error=' + encodeURIComponent('Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.'));
      return;
    }
    const state = newToken();
    setCookie(res, 'oauth_state', state, 10 * 60_000);
    res.redirect(googleAuthUrl(cfg, state));
  });

  r.get('/google/callback', async (req, res) => {
    const fail = (msg: string) => {
      clearCookie(res, 'oauth_state');
      res.redirect('/?auth_error=' + encodeURIComponent(msg));
    };
    const cfg = googleConfig();
    if (!cfg) return fail('Google sign-in is not configured.');
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return fail(error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${error}).`);
    const expected = parseCookies(req.headers.cookie).oauth_state;
    if (!code || !state || !expected || state !== expected) return fail('Google sign-in expired — please try again.');
    clearCookie(res, 'oauth_state');

    let profile: GoogleProfile;
    try {
      profile = await googleProfile(cfg, code);
    } catch (e) {
      console.error(e);
      return fail('Could not reach Google — please try again.');
    }

    let id: number;
    const bySub = userRow('google_sub = ?', profile.sub);
    const byEmail = profile.email && profile.emailVerified ? userRow('email = ?', profile.email.toLowerCase()) : undefined;
    if (bySub) {
      id = bySub.id;
      absorbGuest(req, id);
    } else if (byEmail) {
      id = byEmail.id; // link Google to the existing email account
      db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(profile.sub, id);
      absorbGuest(req, id);
    } else if (req.user?.isGuest) {
      id = req.user.id; // upgrade the guest in place
      db.prepare('UPDATE users SET google_sub = ?, email = ?, name = COALESCE(NULLIF(?, \'\'), name), is_guest = 0 WHERE id = ?').run(
        profile.sub,
        profile.emailVerified ? profile.email?.toLowerCase() : null,
        profile.name,
        id,
      );
    } else {
      id = createUser({ name: profile.name, email: profile.emailVerified ? profile.email?.toLowerCase() : null, googleSub: profile.sub, isGuest: false });
    }
    signIn(req, res, id);
    res.redirect('/');
  });

  return r;
}

