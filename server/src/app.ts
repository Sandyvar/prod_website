import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import type { DB } from './db.js';
import { HttpError } from './repo.js';
import { loadUser, requireUser, sameOrigin } from './auth.js';
import { authRouter } from './routes/auth.js';
import { tasksRouter } from './routes/tasks.js';
import { glossaryRouter, notesRouter, peopleRouter, projectsRouter } from './routes/memory.js';
import { dataRouter } from './routes/data.js';
import { settingsRouter } from './routes/settings.js';
import { localNowMiddleware } from './localTime.js';

interface AppOptions {
  staticDir?: string;
  /** New users start with example data (default true; tests usually turn it off). */
  seedNewUsers?: boolean;
  /** Trust X-Forwarded-* headers (set when running behind a reverse proxy). */
  trustProxy?: boolean;
}

export function createApp(db: DB, opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', sameOrigin, loadUser(db), localNowMiddleware);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter(db, { seedNewUsers: opts.seedNewUsers ?? true }));

  // Everything below needs a signed-in user (account or guest) and only sees that user's data.
  app.use('/api', requireUser);
  app.use('/api/tasks', tasksRouter(db));
  app.use('/api/people', peopleRouter(db));
  app.use('/api/projects', projectsRouter(db));
  app.use('/api/glossary', glossaryRouter(db));
  app.use('/api/notes', notesRouter(db));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api', dataRouter(db));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(opts.staticDir!, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      // Sign-in forms show the message to people as-is, so leave out the field path there.
      const friendly = req.path.startsWith('/api/auth/');
      const error = details.map((d) => (d.path && !friendly ? `${d.path}: ${d.message}` : d.message)).join(friendly ? ' ' : '; ');
      res.status(400).json({ error, details });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT_FOREIGNKEY')) {
      res.status(400).json({ error: 'Linked person or project does not exist' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(onError);

  return app;
}
