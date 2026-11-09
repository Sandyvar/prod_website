import { Router } from 'express';
import type { DB } from '../db.js';
import { uid } from '../auth.js';
import { getSettings, updateSettings } from '../repo.js';
import { settingsUpdate } from '../validation.js';

export function settingsRouter(db: DB) {
  const r = Router();
  r.get('/', (req, res) => {
    res.json(getSettings(db, uid(req)));
  });
  r.put('/', (req, res) => {
    const patch = settingsUpdate.parse(req.body);
    if (patch.name !== undefined && !patch.name) delete patch.name; // a user always keeps a name
    res.json(updateSettings(db, uid(req), patch));
  });
  return r;
}
