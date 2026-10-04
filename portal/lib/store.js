const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.BUZZER_DB || path.join(__dirname, '..', 'buzzer.db');
const BACKUP_FILE = DB_FILE + '.bak';
const LEGACY_FILE = path.join(__dirname, '..', 'data.json');
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

function migrateLegacy(d) {
  if (!d.teams && Array.isArray(d.buzzers)) {
    d.teams = d.buzzers.map((b) => ({ id: b.id, name: b.name, pin: b.pin }));
    d.seq = d.seq || {};
    d.seq.team = d.nextBuzzerId || 1;
  }
  return d;
}

function open() {
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contests (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

// Write a consistent copy of the database (recovery point if the main file is ever lost).
function backup() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(DB_FILE, BACKUP_FILE);
  } catch (e) {
    console.error('[db] backup failed:', e.message);
  }
}

let lastBackup = 0;
function maybeBackup() {
  const now = Date.now();
  if (now - lastBackup > 30000) { lastBackup = now; backup(); }
}

function readAll(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY id`).all().map((r) => JSON.parse(r.data));
}

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function load() {
  // If the main database file is missing but a backup exists, restore it automatically.
  if (!fs.existsSync(DB_FILE) && fs.existsSync(BACKUP_FILE)) {
    try {
      fs.copyFileSync(BACKUP_FILE, DB_FILE);
      console.log('[db] main database missing - restored from backup');
    } catch (e) {
      console.error('[db] restore failed:', e.message);
    }
  }
  open();
  state = JSON.parse(JSON.stringify(DEFAULTS));

  const meta = {};
  db.prepare('SELECT key, value FROM meta').all().forEach((r) => { meta[r.key] = JSON.parse(r.value); });

  const hasData = count('users') > 0 || count('teams') > 0 || count('contests') > 0 || Object.keys(meta).length > 0;

  if (!hasData && fs.existsSync(LEGACY_FILE)) {
    try {
      const legacy = migrateLegacy(JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')));
      state.users = legacy.users || [];
      state.teams = legacy.teams || [];
      state.contests = legacy.contests || [];
      state.seq = { ...DEFAULTS.seq, ...(legacy.seq || {}) };
      state.device = { ...DEFAULTS.device, ...(legacy.device || {}) };
      state.test = { ...DEFAULTS.test, ...(legacy.test || {}) };
      state.pendingCommands = legacy.pendingCommands || [];
      state.nextCommandId = legacy.nextCommandId || 1;
      state.configVersion = legacy.configVersion || 1;
      save();
      fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
      console.log('[db] migrated data.json -> buzzer.db');
    } catch (e) {
      console.error('[db] migration failed:', e.message);
    }
  } else {
    state.users = readAll('users');
    state.teams = readAll('teams');
    state.contests = readAll('contests');
    state.seq = { ...DEFAULTS.seq, ...(meta.seq || {}) };
    state.device = { ...DEFAULTS.device, ...(meta.device || {}) };
    state.test = { ...DEFAULTS.test, ...(meta.test || {}) };
    state.pendingCommands = Array.isArray(meta.pendingCommands) ? meta.pendingCommands : [];
    state.nextCommandId = meta.nextCommandId || 1;
    state.configVersion = meta.configVersion || 1;
  }
  backup();
}

const SAVE = {
  user: null, team: null, contest: null, meta: null,
};

function save() {
  SAVE.user = SAVE.user || db.prepare('INSERT INTO users (id,data) VALUES (?,?)');
  SAVE.team = SAVE.team || db.prepare('INSERT INTO teams (id,data) VALUES (?,?)');
  SAVE.contest = SAVE.contest || db.prepare('INSERT INTO contests (id,data) VALUES (?,?)');
  SAVE.meta = SAVE.meta || db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM users; DELETE FROM teams; DELETE FROM contests;');
    state.users.forEach((u) => SAVE.user.run(u.id, JSON.stringify(u)));
    state.teams.forEach((t) => SAVE.team.run(t.id, JSON.stringify(t)));
    state.contests.forEach((c) => SAVE.contest.run(c.id, JSON.stringify(c)));
    SAVE.meta.run('seq', JSON.stringify(state.seq));
    SAVE.meta.run('configVersion', JSON.stringify(state.configVersion || 1));
    SAVE.meta.run('device', JSON.stringify(state.device));
    SAVE.meta.run('test', JSON.stringify(state.test));
    SAVE.meta.run('pendingCommands', JSON.stringify(state.pendingCommands || []));
    SAVE.meta.run('nextCommandId', JSON.stringify(state.nextCommandId || 1));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  maybeBackup();
}

function next(name) {
  const v = state.seq[name] || 1;
  state.seq[name] = v + 1;
  return v;
}

function get() {
  return state;
}

module.exports = { load, save, get, next, DB_FILE, UPLOAD_DIR };
