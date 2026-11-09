import path from 'node:path';

// Load .env (Google OAuth keys, APP_URL, …) if present. Real environment variables win.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');
const { pruneExpired, googleConfig } = await import('./auth.js');

const port = Number(process.env.PORT ?? 3001);
const db = openDb();
const staticDir = process.env.NODE_ENV === 'production' ? path.resolve(process.cwd(), 'client/dist') : undefined;
const app = createApp(db, { staticDir, trustProxy: process.env.TRUST_PROXY === 'true' });

pruneExpired(db);
setInterval(() => pruneExpired(db), 24 * 3600_000).unref();

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}${staticDir ? ' (serving client/dist)' : ''}`);
  console.log(googleConfig() ? 'Google sign-in: enabled' : 'Google sign-in: not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env)');
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
