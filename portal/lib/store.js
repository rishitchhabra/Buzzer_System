const fs = require('fs');
const path = require('path');

// Optional SQLite backend (Node >= 22.5). Falls back to a JSON file store on older Node.
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* not available */ }

const FORCE_JSON = process.env.BUZZER_STORE === 'json';
const USE_SQLITE = !!DatabaseSync && !FORCE_JSON;

const DB_FILE = process.env.BUZZER_DB || path.join(__dirname, '..', 'buzzer.db');
const BACKUP_FILE = DB_FILE + '.bak';
const LEGACY_FILE = path.join(__dirname, '..', 'data.json');
const JSON_FILE = process.env.BUZZER_JSON || path.join(__dirname, '..', 'data.json');
const JSON_BACKUP = JSON_FILE + '.bak';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const DEFAULTS = {
  users: [],
  teams: [],
  contests: [],
  device: { id: null, lastSeen: 0, rssi: null, ip: null, mode: 'idle', fw: null, uptime: 0, lastPong: null },
  seq: { team: 1, user: 1, contest: 1, round: 1, question: 1 },
  configVersion: 1,
  pendingCommands: [],
  nextCommandId: 1,
  test: { active: false, results: {} },
};

let db = null;
let state = null;

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function migrateLegacy(d) {
  if (!d.teams && Array.isArray(d.buzzers)) {
    d.teams = d.buzzers.map((b) => ({ id: b.id, name: b.name, pin: b.pin }));
    d.seq = d.seq || {};
    d.seq.team = d.nextBuzzerId || 1;
  }
  return d;
}

// ============================ SQLite backend ============================
function sqliteOpen() {
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contests (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

function sqliteReadAll(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY id`).all().map((r) => JSON.parse(r.data));
}
function sqliteCount(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

const SQL = { user: null, team: null, contest: null, meta: null };
function sqliteSave() {
  SQL.user = SQL.user || db.prepare('INSERT INTO users (id,data) VALUES (?,?)');
  SQL.team = SQL.team || db.prepare('INSERT INTO teams (id,data) VALUES (?,?)');
  SQL.contest = SQL.contest || db.prepare('INSERT INTO contests (id,data) VALUES (?,?)');
  SQL.meta = SQL.meta || db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM users; DELETE FROM teams; DELETE FROM contests;');
    state.users.forEach((u) => SQL.user.run(u.id, JSON.stringify(u)));
    state.teams.forEach((t) => SQL.team.run(t.id, JSON.stringify(t)));
    state.contests.forEach((c) => SQL.contest.run(c.id, JSON.stringify(c)));
    SQL.meta.run('seq', JSON.stringify(state.seq));
    SQL.meta.run('configVersion', JSON.stringify(state.configVersion || 1));
    SQL.meta.run('device', JSON.stringify(state.device));
    SQL.meta.run('test', JSON.stringify(state.test));
    SQL.meta.run('pendingCommands', JSON.stringify(state.pendingCommands || []));
    SQL.meta.run('nextCommandId', JSON.stringify(state.nextCommandId || 1));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function loadSQLite() {
  if (!fs.existsSync(DB_FILE) && fs.existsSync(BACKUP_FILE)) {
    try { fs.copyFileSync(BACKUP_FILE, DB_FILE); console.log('[db] main database missing - restored from backup'); } catch (e) {}
  }
  sqliteOpen();
  const meta = {};
  db.prepare('SELECT key, value FROM meta').all().forEach((r) => { meta[r.key] = JSON.parse(r.value); });
  const hasData = sqliteCount('users') > 0 || sqliteCount('teams') > 0 || sqliteCount('contests') > 0 || Object.keys(meta).length > 0;

  if (!hasData && fs.existsSync(LEGACY_FILE)) {
    try {
      const legacy = migrateLegacy(JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')));
      applyLoaded(legacy);
      sqliteSave();
      fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
      console.log('[db] migrated data.json -> buzzer.db');
    } catch (e) { console.error('[db] migration failed:', e.message); }
  } else {
    state.users = sqliteReadAll('users');
    state.teams = sqliteReadAll('teams');
    state.contests = sqliteReadAll('contests');
    applyMeta(meta);
  }
}

// ============================ JSON backend ============================
function jsonSave() {
  const tmp = JSON_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, JSON_FILE);
}

function loadJSON() {
  if (!fs.existsSync(JSON_FILE) && fs.existsSync(JSON_BACKUP)) {
    try { fs.copyFileSync(JSON_BACKUP, JSON_FILE); console.log('[store] file missing - restored from backup'); } catch (e) {}
  }
  try {
    const d = migrateLegacy(JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')));
    applyLoaded(d);
  } catch (e) { /* first run */ }
}

// ============================ shared helpers ============================
function applyLoaded(d) {
  state.users = d.users || [];
  state.teams = d.teams || [];
  state.contests = d.contests || [];
  state.seq = { ...DEFAULTS.seq, ...(d.seq || {}) };
  state.device = { ...DEFAULTS.device, ...(d.device || {}) };
  state.test = { ...DEFAULTS.test, ...(d.test || {}) };
  state.pendingCommands = d.pendingCommands || [];
  state.nextCommandId = d.nextCommandId || 1;
  state.configVersion = d.configVersion || 1;
}

function applyMeta(meta) {
  state.seq = { ...DEFAULTS.seq, ...(meta.seq || {}) };
  state.device = { ...DEFAULTS.device, ...(meta.device || {}) };
  state.test = { ...DEFAULTS.test, ...(meta.test || {}) };
  state.pendingCommands = Array.isArray(meta.pendingCommands) ? meta.pendingCommands : [];
  state.nextCommandId = meta.nextCommandId || 1;
  state.configVersion = meta.configVersion || 1;
}

function backup() {
  try {
    if (USE_SQLITE) {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      fs.copyFileSync(DB_FILE, BACKUP_FILE);
    } else {
      fs.copyFileSync(JSON_FILE, JSON_BACKUP);
    }
  } catch (e) { /* ignore */ }
}

let lastBackup = 0;
function maybeBackup() {
  const now = Date.now();
  if (now - lastBackup > 30000) { lastBackup = now; backup(); }
}

// ============================ public API ============================
function load() {
  state = clone(DEFAULTS);
  if (USE_SQLITE) loadSQLite(); else loadJSON();
  backup();
  console.log(`[store] using ${USE_SQLITE ? 'SQLite (' + DB_FILE + ')' : 'JSON file (' + JSON_FILE + ')'}`);
  if (!USE_SQLITE) console.log('[store] tip: Node >= 22.5 enables the SQLite database');
}

function save() {
  if (USE_SQLITE) sqliteSave(); else jsonSave();
  maybeBackup();
}

function next(name) {
  const v = state.seq[name] || 1;
  state.seq[name] = v + 1;
  return v;
}

function get() { return state; }

module.exports = { load, save, get, next, DB_FILE, JSON_FILE, UPLOAD_DIR, usingSQLite: () => USE_SQLITE };
