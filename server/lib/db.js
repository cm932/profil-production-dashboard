// SQLite на встроенном модуле node:sqlite (без npm-зависимостей). Все запросы — только с параметрами (защита от SQL-инъекций).
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SEED_PATH = path.join(HERE, '..', 'seed.json')

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','director','chief','otk')),
  shop TEXT,
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  demo INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);

CREATE TABLE IF NOT EXISTS downtime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT,
  date TEXT NOT NULL,
  machine TEXT NOT NULL,
  machine_name TEXT NOT NULL DEFAULT '',
  op TEXT NOT NULL,
  shop TEXT NOT NULL DEFAULT '',
  shift INTEGER NOT NULL CHECK (shift IN (1,2)),
  reason TEXT NOT NULL,
  planned INTEGER NOT NULL CHECK (planned IN (0,1)),
  min INTEGER NOT NULL CHECK (min >= 0),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  op TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  order_no TEXT NOT NULL DEFAULT '',
  shift INTEGER NOT NULL CHECK (shift IN (1,2)),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id INTEGER,
  login TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  detail TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_downtime_date ON downtime(date);
CREATE INDEX IF NOT EXISTS idx_defects_date ON defects(date);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
`

export const nowIso = () => new Date().toISOString()

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  return db
}

/** Транзакция: откатывается при любой ошибке */
export function tx(db, fn) {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

const DEFAULT_SETTINGS = { shiftHours: 8, hourCost: 3000, pieceCost: 1500 }

export function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS }
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    const n = Number(r.value)
    if (r.key in out && Number.isFinite(n)) out[r.key] = n
  }
  return out
}

export function setSettings(db, s) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  tx(db, () => { for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in s) st.run(k, String(s[k])) })
}

export function audit(db, { user, login, action, entity = null, detail = null, ip = null }) {
  db.prepare('INSERT INTO audit (ts, user_id, login, action, entity, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), user?.id ?? null, login ?? user?.login ?? null, action, entity, detail == null ? null : String(detail).slice(0, 500), ip)
}

/** Загрузить журналы из seed.json (исходные файлы задания). mode 'replace' очищает таблицы. */
export function loadSeed(db, { replace = false } = {}) {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'))
  const ts = nowIso()
  tx(db, () => {
    if (replace) { db.exec('DELETE FROM downtime; DELETE FROM defects;') }
    const d = db.prepare('INSERT INTO downtime (ext_id, date, machine, machine_name, op, shop, shift, reason, planned, min, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)')
    for (const r of seed.downtime) d.run(r.id, r.date, r.machine, r.machineName, r.op, r.shop, r.shift, r.reason, r.planned ? 1 : 0, r.min, ts)
    const f = db.prepare('INSERT INTO defects (ext_id, date, type, op, qty, order_no, shift, created_by, created_at) VALUES (?,?,?,?,?,?,?,NULL,?)')
    for (const r of seed.defects) f.run(r.id, r.date, r.type, r.op, r.qty, r.order, r.shift, ts)
  })
  return { downtime: seed.downtime.length, defects: seed.defects.length }
}
