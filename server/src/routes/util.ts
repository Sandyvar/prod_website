import { HttpError } from '../repo.js';

export function parseId(raw: string | string[] | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Builds "a = @a, b = @b" from a validated patch object (camelCase keys → snake_case columns). */
export function buildSet(patch: Record<string, unknown>, now: string) {
  const params: Record<string, unknown> = { updated_at: now };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) params[camelToSnake(k)] = v;
  }
  const sql = Object.keys(params)
    .map((c) => `${c} = @${c}`)
    .join(', ');
  return { sql, params };
}
