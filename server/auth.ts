// Autenticação: senhas com scrypt, sessões em cookie httpOnly e controle de acesso por perfil.

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, nowIso, transaction } from './db.ts';
import type { Role, User } from '../shared/types.ts';

const COOKIE = 'ca_session';
const SESSION_DAYS = 14;

// ---------- Senhas ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (password.length > 200) return 'Senha longa demais.';
  return null;
}

// ---------- Usuários ----------

interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  active: number;
  created_at: string;
  last_login_at: string | null;
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  active: Boolean(r.active),
  created_at: r.created_at,
  last_login_at: r.last_login_at,
});

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as UserRow | undefined;
}

export function listUsers(): User[] {
  return (db.prepare('SELECT * FROM users ORDER BY name').all() as unknown as UserRow[]).map(toUser);
}

export function createUser(input: { name: string; email: string; password: string; role: Role }): User {
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(input.name.trim(), input.email.trim().toLowerCase(), hashPassword(input.password), input.role, nowIso());
  return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as unknown as UserRow);
}

/** Cria o primeiro administrador. Falha se já existir qualquer usuário (evita corrida). */
export function createFirstAdmin(input: { name: string; email: string; password: string }): User | null {
  return transaction(() => (userCount() > 0 ? null : createUser({ ...input, role: 'admin' })));
}

export function activeAdminCount(excludeId?: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(excludeId ?? -1) as {
      n: number;
    }
  ).n;
}

// ---------- Sessões ----------

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function startSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    nowIso(),
    expires.toISOString(),
  );
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    expires,
    path: '/',
  });
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function revokeUserSessions(userId: number) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

/** Carrega o usuário da sessão (se houver) em `req.user`. */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(sha256(token), nowIso()) as UserRow | undefined;
    if (row) req.user = toUser(row);
  }
  next();
}

const RANK: Record<Role, number> = { operator: 1, manager: 2, admin: 3 };

/** Exige sessão válida e, opcionalmente, um perfil mínimo. */
export function requireRole(min: Role = 'operator') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      return;
    }
    if (RANK[req.user.role] < RANK[min]) {
      res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
      return;
    }
    next();
  };
}

// ---------- Limite de tentativas de login ----------

const attempts = new Map<string, { count: number; until: number }>();

export function loginBlocked(key: string): boolean {
  const a = attempts.get(key);
  return Boolean(a && a.count >= 8 && a.until > Date.now());
}

export function registerLoginFailure(key: string) {
  const a = attempts.get(key);
  const fresh = !a || a.until < Date.now();
  attempts.set(key, { count: fresh ? 1 : a.count + 1, until: Date.now() + 15 * 60_000 });
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
