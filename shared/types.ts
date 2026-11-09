export const STATUSES = ['active', 'scheduled', 'waiting', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  waiting: 'Waiting On',
  done: 'Done',
};

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const REPEATS = ['none', 'daily', 'weekly', 'monthly'] as const;
export type Repeat = (typeof REPEATS)[number];

export const PROJECT_STATUSES = ['planned', 'active', 'on hold', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const VIEWS = ['board', 'list', 'calendar'] as const;
export type View = (typeof VIEWS)[number];

export interface Task {
  id: number;
  title: string;
  notes: string;
  forPerson: string;
  dueDate: string | null; // YYYY-MM-DD (local)
  scheduledDate: string | null; // YYYY-MM-DD (local)
  scheduledTime: string | null; // HH:mm (local)
  repeat: Repeat;
  priority: Priority;
  tags: string[];
  status: Status;
  position: number;
  personId: number | null;
  projectId: number | null;
  createdAt: string; // ISO timestamp
  completedAt: string | null;
  waitingSince: string | null;
  updatedAt: string;
}

/** Response of any call that can complete a task: repeating tasks spawn their next occurrence. */
export interface TaskMutation {
  task: Task;
  spawned: Task[];
}

export interface Person {
  id: number;
  nickname: string;
  fullName: string;
  role: string;
  company: string;
  email: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: number;
  name: string;
  status: ProjectStatus;
  description: string;
  personIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryTerm {
  id: number;
  term: string;
  meaning: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: number;
  title: string;
  body: string; // markdown
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  name: string;
  theme: 'light' | 'dark' | null; // null = follow system
  defaultView: View;
}

export interface Backup {
  app: 'productivity';
  version: 2;
  exportedAt: string;
  settings: Settings;
  tasks: Task[];
  people: Person[];
  projects: Project[];
  glossary: GlossaryTerm[];
  notes: Note[];
}
