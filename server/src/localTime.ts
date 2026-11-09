import type { RequestHandler } from 'express';

/**
 * The browser's local "now", sent by the client on every request as
 *   X-Local-Now: 2026-11-10T14:05
 * so scheduling and repeat logic follow the user's time zone, not the server's.
 * Falls back to the server's local clock when the header is missing or malformed.
 */
export interface LocalNow {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

const pad = (n: number) => String(n).padStart(2, '0');

export function serverLocalNow(d = new Date()): LocalNow {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export function parseLocalNow(raw: unknown): LocalNow | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(RE);
  if (!m) return null;
  const [, date, time] = m;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || !d.toISOString().startsWith(date)) return null;
  const [h, min] = time.split(':').map(Number);
  if (h > 23 || min > 59) return null;
  return { date, time };
}

declare module 'express-serve-static-core' {
  interface Request {
    localNow: LocalNow;
  }
}

export const localNowMiddleware: RequestHandler = (req, _res, next) => {
  req.localNow = parseLocalNow(req.get('X-Local-Now')) ?? serverLocalNow();
  next();
};

/** Adds days / months to a YYYY-MM-DD date (calendar arithmetic, no time zones involved). */
export function addToDate(date: string, unit: 'day' | 'week' | 'month', n = 1): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (unit === 'day') dt.setUTCDate(dt.getUTCDate() + n);
  else if (unit === 'week') dt.setUTCDate(dt.getUTCDate() + 7 * n);
  else {
    // Clamp to the end of the month (Jan 31 + 1 month → Feb 28/29)
    const targetMonth = dt.getUTCMonth() + n;
    dt.setUTCDate(1);
    dt.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, lastDay));
  }
  return dt.toISOString().slice(0, 10);
}
