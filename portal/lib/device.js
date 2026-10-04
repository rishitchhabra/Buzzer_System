const { get, save, next } = require('./store');

// Safe ESP32 GPIOs with internal pull-up. Order = assignment order, so
// GPIO22/23 are preferred over 13/14. GPIO19 is reserved for the status LED.
const AVAILABLE_PINS = [4, 5, 22, 23, 16, 17, 18, 21, 13, 14, 25, 26, 27, 32, 33];
const SCAN_SETTLE_MS = 5000;
const COMMAND_TTL_MS = 60000;

function freePin() {
  const st = get();
  const used = new Set(st.teams.map((t) => t.pin));
  return AVAILABLE_PINS.find((p) => !used.has(p));
}

function addTeam(name) {
  const st = get();
  const n = String(name || '').trim().slice(0, 24);
  if (!n) return { ok: false, error: 'Name required' };
  if (st.teams.length >= AVAILABLE_PINS.length) return { ok: false, error: 'Maximum number of teams reached' };
  const pin = freePin();
  if (pin === undefined) return { ok: false, error: 'No free pin available' };
  const team = { id: next('team'), name: n, pin };
  st.teams.push(team);
  st.configVersion++;
  save();
  return { ok: true, team };
}

function deleteTeam(id) {
  const st = get();
  const idx = st.teams.findIndex((t) => t.id === Number(id));
  if (idx < 0) return { ok: false, error: 'Not found' };
  st.teams.splice(idx, 1);
  st.configVersion++;
  save();
  return { ok: true };
}

function enqueue(type) {
  const st = get();
  st.pendingCommands.push({ id: st.nextCommandId++, type, createdAt: Date.now() });
  save();
}

function deviceOnline() {
  const d = get().device;
  return d.lastSeen > 0 && (Date.now() - d.lastSeen) < 5000;
}

function syncResponse() {
  const st = get();
  const now = Date.now();
  st.pendingCommands = st.pendingCommands.filter((c) => now - c.createdAt < COMMAND_TTL_MS);
  return {
    ok: true,
    configVersion: st.configVersion,
    buzzers: st.teams.map((t) => ({ id: t.id, name: t.name, pin: t.pin })),
    scanSettleMs: SCAN_SETTLE_MS,
    commands: st.pendingCommands.map((c) => ({ id: c.id, type: c.type })),
  };
}

function handleSync(query) {
  const st = get();
  const { deviceId, rssi, ip, mode, fw, uptime } = query;
  if (deviceId) st.device.id = deviceId;
  st.device.lastSeen = Date.now();
  if (rssi !== undefined) st.device.rssi = Number(rssi);
  if (ip) st.device.ip = ip;
  if (mode) st.device.mode = mode;
  if (fw) st.device.fw = fw;
  if (uptime !== undefined) st.device.uptime = Number(uptime);
  save();
  return syncResponse();
}

function ackCommand(commandId) {
  const st = get();
  const id = Number(commandId);
  if (id) st.pendingCommands = st.pendingCommands.filter((c) => c.id !== id);
  save();
}

function handleEvent(body) {
  const st = get();
  const { deviceId, type, payload } = body || {};
  if (deviceId) st.device.id = deviceId;
  st.device.lastSeen = Date.now();
  const p = payload || {};

  switch (type) {
    case 'test_update':
      st.test.results[p.id] = !!p.online;
      break;
    case 'test_result':
      st.test.results = {};
      (p.results || []).forEach((r) => { st.test.results[r.id] = !!r.online; });
      st.test.active = false;
      break;
    case 'live_press':
      st.test.results[p.id] = true; // keep test view in sync
      break;
    case 'scan_result':
      st.test.results = {};
      (p.results || []).forEach((r) => { st.test.results[r.id] = true; });
      st.test.active = false;
      break;
    case 'pong':
      st.device.lastPong = { at: Date.now(), rssi: p.rssi, ip: p.ip, mode: p.mode, uptimeS: p.uptimeS };
      break;
    default:
      break;
  }
  save();
}

module.exports = {
  AVAILABLE_PINS, SCAN_SETTLE_MS,
  addTeam, deleteTeam, enqueue, deviceOnline, syncResponse, handleSync, ackCommand, handleEvent, freePin,
};
