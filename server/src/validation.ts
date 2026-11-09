import { z } from 'zod';
import { PRIORITIES, PROJECT_STATUSES, REPEATS, STATUSES, VIEWS } from '../../shared/types.js';

const text = (max: number) => z.string().trim().max(max);
const id = z.number().int().positive();

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Invalid calendar date');

export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time as HH:mm');

const tags = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((t) => [...new Set(t.map((s) => s.toLowerCase()))]);

// ---- Tasks ----
const taskFields = {
  title: text(300).min(1, 'Title is required'),
  notes: text(10000),
  forPerson: text(200),
  dueDate: dateString.nullable(),
  scheduledDate: dateString.nullable(),
  scheduledTime: timeString.nullable(),
  repeat: z.enum(REPEATS),
  priority: z.enum(PRIORITIES),
  tags,
  status: z.enum(STATUSES),
  personId: id.nullable(),
  projectId: id.nullable(),
};
export const taskCreate = z.object(taskFields).partial().required({ title: true });
export const taskUpdate = z
  .object(taskFields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No fields to update');
export const taskReorder = z.object({
  status: z.enum(STATUSES),
  ids: z.array(id).max(5000),
});

// ---- Settings ----
export const settingsUpdate = z
  .object({
    name: text(80),
    theme: z.enum(['light', 'dark']).nullable(),
    defaultView: z.enum(VIEWS),
  })
  .partial();

// ---- People ----
const personFields = {
  nickname: text(100).min(1, 'Nickname is required'),
  fullName: text(200),
  role: text(200),
  company: text(200),
  email: z.union([z.literal(''), z.string().trim().email('Invalid email').max(254)]),
  notes: text(10000),
};
export const personCreate = z.object(personFields).partial().required({ nickname: true });
export const personUpdate = z.object(personFields).partial();

// ---- Projects ----
const projectFields = {
  name: text(200).min(1, 'Name is required'),
  status: z.enum(PROJECT_STATUSES),
  description: text(10000),
  personIds: z.array(id).max(500),
};
export const projectCreate = z.object(projectFields).partial().required({ name: true });
export const projectUpdate = z.object(projectFields).partial();

// ---- Glossary ----
const glossaryFields = {
  term: text(100).min(1, 'Term is required'),
  meaning: text(2000).min(1, 'Meaning is required'),
};
export const glossaryCreate = z.object(glossaryFields);
export const glossaryUpdate = z.object(glossaryFields).partial();

// ---- Notes ----
const noteFields = {
  title: text(300).min(1, 'Title is required'),
  body: text(100000),
};
export const noteCreate = z.object(noteFields).partial().required({ title: true });
export const noteUpdate = z.object(noteFields).partial();

// ---- Import ----
export const markdownImport = z.object({
  markdown: z.string().max(2_000_000),
  mode: z.enum(['append', 'replace']).default('append'),
});

const iso = z.string().min(1).max(40);
// Accepts v1 backups (no scheduling fields, 'someday' status, 'med' priority) and upgrades them.
const backupTask = z.object({
  id,
  ...taskFields,
  status: z.enum([...STATUSES, 'someday']).transform((s) => (s === 'someday' ? 'active' : s)),
  priority: z.enum([...PRIORITIES, 'med']).transform((p) => (p === 'med' ? 'medium' : p)),
  scheduledDate: dateString.nullable().default(null),
  scheduledTime: timeString.nullable().default(null),
  repeat: z.enum(REPEATS).default('none'),
  position: z.number().int(),
  createdAt: iso,
  completedAt: iso.nullable(),
  waitingSince: iso.nullable(),
  updatedAt: iso.optional(),
});

export const backupSchema = z.object({
  app: z.literal('productivity').optional(),
  version: z.union([z.literal(1), z.literal(2)]),
  settings: settingsUpdate.optional(),
  tasks: z.array(backupTask),
  people: z.array(z.object({ id, ...personFields, createdAt: iso, updatedAt: iso.optional() })),
  projects: z.array(z.object({ id, ...projectFields, createdAt: iso, updatedAt: iso.optional() })),
  glossary: z.array(z.object({ id, ...glossaryFields, createdAt: iso, updatedAt: iso.optional() })),
  notes: z.array(z.object({ id, ...noteFields, createdAt: iso, updatedAt: iso.optional() })),
});
export type BackupInput = z.infer<typeof backupSchema>;
