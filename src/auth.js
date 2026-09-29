import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { addEvent, asUser, nowIso } from './db.js';

const SESSION_COOKIE = 'guobu_session';
const SESSION_DAYS = 14;
const VALID_ROLES = new Set(['admin', 'reviewer', 'contributor', 'viewer']);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, encoded) {
  const [scheme, salt, expectedHex] = String(encoded || '').split(':');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

export function createSession(db, userId) {
  const id = randomUUID();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, csrf_token, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, expiresAt, csrfToken, nowIso());
  return { id, csrfToken, expiresAt };
}

export function sessionCookie(sessionId, expiresAt) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getSessionAuth(db, req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const row = db.prepare(`
    SELECT u.*, s.id AS session_id, s.expires_at, s.csrf_token
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(sessionId, nowIso());
  if (!row || row.status !== 'active') return null;
  let csrfToken = row.csrf_token;
  if (!csrfToken) {
    csrfToken = randomToken();
    db.prepare('UPDATE sessions SET csrf_token = ? WHERE id = ?').run(csrfToken, row.session_id);
  }
  return { user: asUser(row), sessionId: row.session_id, csrfToken, expiresAt: row.expires_at };
}

export function getCurrentUser(db, req) {
  return getSessionAuth(db, req)?.user || null;
}

export function requireSessionAuth(db, req) {
  const auth = getSessionAuth(db, req);
  if (!auth) {
    const error = new Error('请先登录');
    error.status = 401;
    throw error;
  }
  return auth;
}

export function requireUser(db, req) {
  return requireSessionAuth(db, req).user;
}

export function requireRole(db, req, roles) {
  const user = requireUser(db, req);
  if (!roles.includes(user.role)) {
    const error = new Error('没有执行该操作的权限');
    error.status = 403;
    throw error;
  }
  return user;
}

export function requireCsrf(db, req) {
  const auth = requireSessionAuth(db, req);
  const token = String(req.headers['x-csrf-token'] || '');
  if (!token || token !== auth.csrfToken) {
    const error = new Error('CSRF 校验失败，请刷新页面后重试');
    error.status = 403;
    throw error;
  }
  return auth;
}

function validateNewUser({ username, displayName, password }) {
  const normalizedUsername = String(username || '').trim();
  const normalizedDisplay = String(displayName || normalizedUsername).trim();
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(normalizedUsername)) {
    const error = new Error('用户名需为 3-40 位字母、数字、点、下划线或短横线');
    error.status = 400;
    throw error;
  }
  if (String(password || '').length < 8) {
    const error = new Error('密码至少 8 位');
    error.status = 400;
    throw error;
  }
  if (!normalizedDisplay || normalizedDisplay.length > 60) {
    const error = new Error('显示名称不能为空且不能超过 60 个字符');
    error.status = 400;
    throw error;
  }
  return { normalizedUsername, normalizedDisplay };
}

function getValidInvite(db, code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  return db.prepare(`
    SELECT * FROM invites
    WHERE code = ? AND disabled = 0 AND used_by IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1
  `).get(normalizedCode, nowIso());
}

export function registerUser(db, { username, displayName, password, inviteCode = '' }) {
  const { normalizedUsername, normalizedDisplay } = validateNewUser({ username, displayName, password });
  const count = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count);
  const isFirstUser = count === 0;
  let invite = null;
  if (!isFirstUser) {
    invite = getValidInvite(db, inviteCode);
    if (!invite && process.env.ALLOW_REGISTRATION !== '1') {
      const error = new Error('当前为邀请注册，请填写有效的邀请码');
      error.status = 403;
      throw error;
    }
  }

  const id = randomUUID();
  const timestamp = nowIso();
  const role = isFirstUser ? 'admin' : (invite?.role || 'contributor');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, normalizedUsername, normalizedDisplay, hashPassword(password), role, timestamp, timestamp);
    if (invite) db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run(id, timestamp, invite.id);
    addEvent(db, { entityType: 'user', entityId: id, actorId: id, action: 'registered', detail: { role, inviteCode: invite?.code || null } });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (String(error.message).includes('UNIQUE')) {
      const conflict = new Error('用户名已存在');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
  return asUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function loginUser(db, { username, password }) {
  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim());
  if (!row || row.status !== 'active' || !verifyPassword(String(password || ''), row.password_hash)) {
    const error = new Error('用户名或密码错误');
    error.status = 401;
    throw error;
  }
  const timestamp = nowIso();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, row.id);
  const session = createSession(db, row.id);
  addEvent(db, { entityType: 'user', entityId: row.id, actorId: row.id, action: 'logged_in' });
  return { user: asUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)), session };
}

export function logoutUser(db, req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function createInvite(db, actorId, { role = 'contributor', note = '', expiresAt = null }) {
  if (!VALID_ROLES.has(role)) {
    const error = new Error('邀请角色不合法');
    error.status = 400;
    throw error;
  }
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    const error = new Error('邀请码过期时间格式不正确');
    error.status = 400;
    throw error;
  }
  const id = randomUUID();
  const code = randomToken(12).toUpperCase();
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO invites (id, code, role, note, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, code, role, String(note || '').trim() || null, expiresAt || null, actorId, timestamp);
  addEvent(db, { entityType: 'invite', entityId: id, actorId, action: 'created', detail: { role, expiresAt } });
  return db.prepare('SELECT * FROM invites WHERE id = ?').get(id);
}

export function changePassword(db, userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !verifyPassword(String(currentPassword || ''), user.password_hash)) {
    const error = new Error('当前密码不正确');
    error.status = 400;
    throw error;
  }
  if (String(newPassword || '').length < 8) {
    const error = new Error('新密码至少 8 位');
    error.status = 400;
    throw error;
  }
  const timestamp = nowIso();
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), timestamp, timestamp, userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  addEvent(db, { entityType: 'user', entityId: userId, actorId: userId, action: 'password_changed' });
}

export function resetPassword(db, targetUserId, actorId, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!user) {
    const error = new Error('用户不存在');
    error.status = 404;
    throw error;
  }
  const temporaryPassword = newPassword || `Tmp-${randomToken(8)}`;
  if (temporaryPassword.length < 8) {
    const error = new Error('新密码至少 8 位');
    error.status = 400;
    throw error;
  }
  const timestamp = nowIso();
  db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(temporaryPassword), timestamp, timestamp, targetUserId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
  addEvent(db, { entityType: 'user', entityId: targetUserId, actorId, action: 'password_reset' });
  return { user: asUser(db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId)), temporaryPassword };
}
