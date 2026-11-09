import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  STATUS_LABELS,
  type GlossaryTerm,
  type Note,
  type Person,
  type Project,
  type Settings,
  type Status,
  type Task,
  type TaskMutation,
} from '../../shared/types';
import { api } from './api';
import { confetti } from './confetti';
import { useToast } from './components/Toasts';
import { byPosition, isForToday, plural } from './utils';

export interface Data {
  tasks: Task[];
  people: Person[];
  projects: Project[];
  glossary: GlossaryTerm[];
  notes: Note[];
  settings: Settings;
}

export type MemoryKind = 'people' | 'projects' | 'glossary' | 'notes';
type MemoryItem<K extends MemoryKind> = Data[K][number];

export type TaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'completedAt' | 'waitingSince' | 'position'>> & { title: string };

interface MoveOpts {
  /** Suppress the "moved · Undo" toast (used by undo itself). */
  silent?: boolean;
  /** Where the confetti should burst from. */
  origin?: { x: number; y: number };
}

interface Store {
  data: Data;
  status: 'loading' | 'ready' | 'error';
  reload: () => Promise<void>;
  peopleById: Map<number, Person>;
  projectsById: Map<number, Project>;
  /** Tasks that just changed column — used for the slide-in animation. */
  recent: Set<number>;
  createTask: (input: TaskInput) => Promise<Task | null>;
  updateTask: (id: number, patch: Partial<Task>, opts?: MoveOpts) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  moveTask: (id: number, status: Status, orderedIds: number[], opts?: MoveOpts) => Promise<void>;
  activateDue: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  createItem: <K extends MemoryKind>(kind: K, input: Partial<MemoryItem<K>>) => Promise<MemoryItem<K> | null>;
  updateItem: <K extends MemoryKind>(kind: K, id: number, patch: Partial<MemoryItem<K>>) => Promise<void>;
  deleteItem: (kind: MemoryKind, id: number) => Promise<void>;
}

const EMPTY: Data = { tasks: [], people: [], projects: [], glossary: [], notes: [], settings: { name: '', theme: null, defaultView: 'board' } };
const StoreContext = createContext<Store | null>(null);
const LABEL: Record<MemoryKind, string> = { people: 'person', projects: 'project', glossary: 'term', notes: 'note' };

/** Mirrors the server's status-change rules so the optimistic state matches what will be saved. */
function applyStatus(t: Task, next: Status, now: string): Partial<Task> {
  return {
    status: next,
    completedAt: next === 'done' ? (t.status === 'done' ? t.completedAt : now) : null,
    waitingSince: next === 'waiting' ? (t.status === 'waiting' ? t.waitingSince : now) : null,
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [data, setData] = useState<Data>(EMPTY);
  const [status, setStatus] = useState<Store['status']>('loading');
  const [recent, setRecent] = useState<Set<number>>(new Set());
  const dataRef = useRef(data);
  dataRef.current = data;

  const tempId = useRef(-1);
  const pendingCreates = useRef(new Map<number, Promise<number | null>>());
  const reqSeq = useRef(new Map<string, number>());
  const nextSeq = (key: string) => {
    const n = (reqSeq.current.get(key) ?? 0) + 1;
    reqSeq.current.set(key, n);
    return n;
  };
  const isLatest = (key: string, n: number) => reqSeq.current.get(key) === n;
  const resolveId = useCallback(async (id: number) => (id < 0 ? ((await pendingCreates.current.get(id)) ?? null) : id), []);

  const setTasks = (fn: (t: Task[]) => Task[]) => setData((d) => ({ ...d, tasks: fn(d.tasks) }));
  const mergeTasks = (incoming: Task[]) =>
    setTasks((ts) => {
      const byId = new Map(incoming.map((t) => [t.id, t]));
      const merged = ts.map((t) => byId.get(t.id) ?? t);
      for (const t of incoming) if (!ts.some((x) => x.id === t.id)) merged.push(t);
      return merged;
    });
  const markRecent = (id: number) => {
    setRecent((r) => new Set(r).add(id));
    setTimeout(
      () =>
        setRecent((r) => {
          const n = new Set(r);
          n.delete(id);
          return n;
        }),
      900,
    );
  };

  const reload = useCallback(async () => {
    try {
      const [tasks, people, projects, glossary, notes, settings] = await Promise.all([
        api.get<Task[]>('/api/tasks'),
        api.get<Person[]>('/api/people'),
        api.get<Project[]>('/api/projects'),
        api.get<GlossaryTerm[]>('/api/glossary'),
        api.get<Note[]>('/api/notes'),
        api.get<Settings>('/api/settings'),
      ]);
      setData({ tasks, people, projects, glossary, notes, settings });
      setStatus('ready');
    } catch (e) {
      setStatus((s) => (s === 'ready' ? s : 'error'));
      toast.error(`Couldn't load data: ${(e as Error).message}`);
    }
  }, [toast]);

  // ---------- Scheduled → Active ----------
  const activateDue = useCallback(async () => {
    try {
      const activated = await api.post<Task[]>('/api/tasks/activate-due');
      if (activated.length) {
        mergeTasks(activated);
        activated.forEach((t) => markRecent(t.id));
        toast.info(`${plural(activated.length, 'scheduled task')} ${activated.length === 1 ? 'is' : 'are'} now active`);
      }
    } catch {
      /* will retry on the next tick */
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Check on load, every minute, and whenever the tab becomes visible again.
  useEffect(() => {
    if (status !== 'ready') return;
    void activateDue();
    const timer = setInterval(() => void activateDue(), 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void activateDue();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, activateDue]);

  // ---------- Helpers for column changes ----------
  const celebrateIfLast = (prev: Task, origin?: MoveOpts['origin']) => {
    const rest = dataRef.current.tasks.filter((t) => t.id !== prev.id);
    const lastForToday = isForToday(prev) && !rest.some(isForToday);
    const activeCleared = prev.status === 'active' && !rest.some((t) => t.status === 'active');
    if (lastForToday || activeCleared) confetti(origin?.x, origin?.y);
  };

  /** Snapshot needed to undo a column change. */
  const snapshot = (task: Task) => ({
    status: task.status,
    order: dataRef.current.tasks
      .filter((t) => t.status === task.status)
      .sort(byPosition)
      .map((t) => t.id),
    repeat: task.repeat,
  });

  // Declared via ref so undo handlers can call the latest moveTask/updateTask.
  const actions = useRef<{ moveTask: Store['moveTask']; updateTask: Store['updateTask'] }>(null!);

  const offerUndo = (taskId: number, snap: ReturnType<typeof snapshot>, to: Status, spawned: Task[]) => {
    toast.success(`Task moved to ${STATUS_LABELS[to]}`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          for (const s of spawned) {
            setTasks((ts) => ts.filter((t) => t.id !== s.id));
            void api.del(`/api/tasks/${s.id}`).catch(() => undefined);
          }
          await actions.current.moveTask(taskId, snap.status, snap.order, { silent: true });
          const now = dataRef.current.tasks.find((t) => t.id === taskId);
          if (now && snap.repeat !== now.repeat) await actions.current.updateTask(taskId, { repeat: snap.repeat }, { silent: true });
        },
      },
    });
  };

  // ---------- Tasks ----------
  const createTask = useCallback<Store['createTask']>(
    async (input) => {
      const id = tempId.current--;
      const now = new Date().toISOString();
      const status = input.status ?? 'active';
      const maxPos = Math.max(0, ...dataRef.current.tasks.filter((t) => t.status === status).map((t) => t.position));
      const optimistic: Task = {
        id,
        notes: '',
        forPerson: '',
        dueDate: null,
        scheduledDate: null,
        scheduledTime: null,
        repeat: 'none',
        priority: 'medium',
        tags: [],
        personId: null,
        projectId: null,
        ...input,
        status,
        position: maxPos + 1,
        createdAt: now,
        updatedAt: now,
        completedAt: status === 'done' ? now : null,
        waitingSince: status === 'waiting' ? now : null,
      };
      setTasks((ts) => [...ts, optimistic]);
      markRecent(id);
      let saved: Task | null = null;
      const promise = api
        .post<Task>('/api/tasks', input)
        .then((s) => {
          saved = s;
          setTasks((ts) => ts.map((t) => (t.id === id ? s : t)));
          return s.id;
        })
        .catch((e: Error) => {
          setTasks((ts) => ts.filter((t) => t.id !== id));
          toast.error(`Couldn't save task: ${e.message}`);
          return null;
        });
      pendingCreates.current.set(id, promise);
      await promise;
      if (saved && (saved as Task).status === 'scheduled') void activateDue();
      return saved;
    },
    [toast, activateDue],
  );

  const updateTask = useCallback<Store['updateTask']>(
    async (id, patch, opts = {}) => {
      const prev = dataRef.current.tasks.find((t) => t.id === id);
      if (!prev) return;
      const now = new Date().toISOString();
      const changingColumn = !!patch.status && patch.status !== prev.status;
      let optimistic: Task = { ...prev, ...patch, updatedAt: now };
      if ('scheduledDate' in patch && !patch.scheduledDate) optimistic.scheduledTime = null;
      const snap = snapshot(prev);
      if (changingColumn) {
        const col = dataRef.current.tasks.filter((t) => t.status === patch.status).map((t) => t.position);
        const position = patch.status === 'done' ? Math.min(0, ...col) - 1 : Math.max(0, ...col) + 1;
        optimistic = { ...optimistic, ...applyStatus(prev, patch.status!, now), position };
        if (patch.status === 'done') celebrateIfLast(prev, opts.origin);
        markRecent(id);
      }
      setTasks((ts) => ts.map((t) => (t.id === id ? optimistic : t)));
      const realId = await resolveId(id);
      if (realId === null) return;
      const key = `task:${realId}`;
      const seq = nextSeq(key);
      try {
        const res = await api.put<TaskMutation>(`/api/tasks/${realId}`, patch);
        if (isLatest(key, seq)) mergeTasks([res.task]);
        if (res.spawned.length) mergeTasks(res.spawned);
        if (changingColumn && !opts.silent) offerUndo(realId, snap, patch.status!, res.spawned);
        if ((patch.scheduledDate || patch.scheduledTime) && res.task.status === 'scheduled') void activateDue();
      } catch (e) {
        if (isLatest(key, seq)) setTasks((ts) => ts.map((t) => (t.id === realId ? { ...prev, id: realId } : t)));
        toast.error(`Couldn't save change: ${(e as Error).message}`);
      }
    },
    [toast, resolveId, activateDue],
  );

  const moveTask = useCallback<Store['moveTask']>(
    async (id, status, orderedIds, opts = {}) => {
      const before = dataRef.current.tasks;
      const prev = before.find((t) => t.id === id);
      if (!prev) return;
      const snap = snapshot(prev);
      const changingColumn = prev.status !== status;
      const now = new Date().toISOString();
      const order = new Map(orderedIds.map((tid, i) => [tid, i]));
      if (changingColumn) {
        if (status === 'done') celebrateIfLast(prev, opts.origin);
        markRecent(id);
      }
      setTasks((ts) =>
        ts.map((t) => (order.has(t.id) ? { ...t, ...(t.status !== status ? applyStatus(t, status, now) : {}), position: order.get(t.id)! } : t)),
      );
      try {
        const ids = (await Promise.all(orderedIds.map(resolveId))).filter((x): x is number => x !== null);
        const res = await api.post<{ tasks: Task[]; spawned: Task[] }>('/api/tasks/reorder', { status, ids });
        mergeTasks([...res.tasks, ...res.spawned]);
        if (changingColumn && !opts.silent) offerUndo(id, snap, status, res.spawned);
      } catch (e) {
        setTasks(() => before);
        toast.error(`Couldn't move task: ${(e as Error).message}`);
      }
    },
    [toast, resolveId],
  );

  actions.current = { moveTask, updateTask };

  const deleteTask = useCallback<Store['deleteTask']>(
    async (id) => {
      const prev = dataRef.current.tasks.find((t) => t.id === id);
      if (!prev) return;
      setTasks((ts) => ts.filter((t) => t.id !== id));
      const realId = await resolveId(id);
      if (realId === null) return;
      setTasks((ts) => ts.filter((t) => t.id !== realId));
      try {
        await api.del(`/api/tasks/${realId}`);
        toast.success('Task deleted', {
          action: {
            label: 'Undo',
            onClick: () => {
              const { id: _id, createdAt: _c, updatedAt: _u, completedAt: _d, waitingSince: _w, position: _p, ...rest } = prev;
              void createTask(rest);
            },
          },
        });
      } catch (e) {
        setTasks((ts) => [...ts, { ...prev, id: realId }]);
        toast.error(`Couldn't delete task: ${(e as Error).message}`);
      }
    },
    [toast, resolveId, createTask],
  );

  // ---------- Settings ----------
  const updateSettings = useCallback<Store['updateSettings']>(
    async (patch) => {
      const prev = dataRef.current.settings;
      setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      const seq = nextSeq('settings');
      try {
        const saved = await api.put<Settings>('/api/settings', patch);
        if (isLatest('settings', seq)) setData((d) => ({ ...d, settings: saved }));
      } catch (e) {
        if (isLatest('settings', seq)) setData((d) => ({ ...d, settings: prev }));
        toast.error(`Couldn't save settings: ${(e as Error).message}`);
      }
    },
    [toast],
  );

  // ---------- Memory ----------
  const createItem = useCallback(
    async <K extends MemoryKind>(kind: K, input: Partial<MemoryItem<K>>) => {
      try {
        const saved = await api.post<MemoryItem<K>>(`/api/${kind}`, input);
        setData((d) => ({ ...d, [kind]: [...d[kind], saved] }));
        return saved;
      } catch (e) {
        toast.error(`Couldn't create ${LABEL[kind]}: ${(e as Error).message}`);
        return null;
      }
    },
    [toast],
  ) as Store['createItem'];

  const updateItem = useCallback(
    async <K extends MemoryKind>(kind: K, id: number, patch: Partial<MemoryItem<K>>) => {
      const prev = (dataRef.current[kind] as MemoryItem<K>[]).find((x) => x.id === id);
      if (!prev) return;
      const replace = (item: MemoryItem<K>) => setData((d) => ({ ...d, [kind]: (d[kind] as MemoryItem<K>[]).map((x) => (x.id === id ? item : x)) }));
      replace({ ...prev, ...patch });
      const key = `${kind}:${id}`;
      const seq = nextSeq(key);
      try {
        const saved = await api.put<MemoryItem<K>>(`/api/${kind}/${id}`, patch);
        if (isLatest(key, seq)) replace(saved);
      } catch (e) {
        if (isLatest(key, seq)) replace(prev);
        toast.error(`Couldn't save ${LABEL[kind]}: ${(e as Error).message}`);
      }
    },
    [toast],
  ) as Store['updateItem'];

  const deleteItem = useCallback<Store['deleteItem']>(
    async (kind, id) => {
      const before = dataRef.current;
      setData((d) => {
        const next: Data = { ...d, [kind]: (d[kind] as { id: number }[]).filter((x) => x.id !== id) };
        if (kind === 'people') {
          next.tasks = d.tasks.map((t) => (t.personId === id ? { ...t, personId: null } : t));
          next.projects = (next.projects as Project[]).map((p) => ({ ...p, personIds: p.personIds.filter((x) => x !== id) }));
        }
        if (kind === 'projects') next.tasks = d.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t));
        return next;
      });
      try {
        await api.del(`/api/${kind}/${id}`);
        toast.success(`Deleted ${LABEL[kind]}`);
      } catch (e) {
        setData(before);
        toast.error(`Couldn't delete ${LABEL[kind]}: ${(e as Error).message}`);
      }
    },
    [toast],
  );

  const peopleById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const projectsById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects]);

  const value = useMemo<Store>(
    () => ({
      data,
      status,
      reload,
      peopleById,
      projectsById,
      recent,
      createTask,
      updateTask,
      deleteTask,
      moveTask,
      activateDue,
      updateSettings,
      createItem,
      updateItem,
      deleteItem,
    }),
    [data, status, reload, peopleById, projectsById, recent, createTask, updateTask, deleteTask, moveTask, activateDue, updateSettings, createItem, updateItem, deleteItem],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useData() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}
