const crypto = require('node:crypto');
const db = require('../db');
const { HttpError } = require('./http');

const SESSION_TTL = 1000 * 60 * 60 * 12;
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, role: user.role, createdAt: Date.now(), lastSeen: Date.now() });
  db.run("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?", [user.id]);
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function sweep() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL) sessions.delete(token);
  }
}

function parseToken(req, body) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.headers['cookie'];
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)zain_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  if (body && typeof body === 'object' && body.token) return String(body.token);
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('token');
  if (q) return q;
  return null;
}

function getSession(req, body) {
  const token = parseToken(req, body);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.lastSeen > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  session.lastSeen = Date.now();
  const user = db.get(
    `SELECT id, username, full_name, role, permissions, is_active FROM users WHERE id = ? AND is_active = 1`,
    [session.userId]
  );
  if (!user) {
    sessions.delete(token);
    return null;
  }
  return { token, session, user };
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  let perms = [];
  try {
    perms = JSON.parse(user.permissions || '[]');
  } catch {
    perms = [];
  }
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const [mod] = String(permission).split('.');
  return perms.includes(`${mod}.*`);
}

function login(username, password) {
  const user = db.get('SELECT * FROM users WHERE username = ?', [String(username || '').trim()]);
  if (!user) throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  if (!user.is_active) throw new HttpError(403, 'الحساب معطل');
  if (!db.verifyPassword(password, user.password_salt, user.password_hash)) {
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  const token = createSession(user);
  db.logActivity(user.id, 'login', 'users', user.id, { username: user.username });
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      permissions: JSON.parse(user.permissions || '[]'),
    },
  };
}

function hashNewPassword(password, salt) {
  return db.hashPassword(password, salt);
}

module.exports = {
  sessions,
  createSession,
  destroySession,
  sweep,
  getSession,
  hasPermission,
  login,
  hashNewPassword,
};
