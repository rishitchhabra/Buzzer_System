const crypto = require('crypto');
const { get, save } = require('./store');

const sessions = new Map(); // token -> userId

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
  } catch (e) {
    return false;
  }
}

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

function createDefaultAdmin() {
  const st = get();
  if (st.users.length === 0) {
    st.users.push({ id: 1, username: 'admin', name: 'Admin', role: 'admin', passwordHash: hashPassword('admin123') });
    save();
    console.log('\n  Default login created ->  username: admin   password: admin123  (change it!)\n');
  }
}

function findUser(id) {
  return get().users.find((u) => u.id === Number(id));
}

function login(username, password) {
  const u = get().users.find((x) => x.username === String(username).trim());
  if (!u || !verifyPassword(password, u.passwordHash)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, u.id);
  return { token, user: publicUser(u) };
}

function logout(token) {
  sessions.delete(token);
}

function getUserByToken(token) {
  if (!token) return null;
  const id = sessions.get(token);
  return id ? findUser(id) : null;
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const u = token ? getUserByToken(token) : null;
  if (!u) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  req.user = u;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin only' });
  }
  next();
}

module.exports = {
  login, logout, getUserByToken, publicUser, requireAuth, requireAdmin,
  createDefaultAdmin, hashPassword, verifyPassword,
};
