// Status dos leads configuráveis: nome, cor, tipo (entrada, andamento, ganho, perdido) e ordem.

import crypto from 'node:crypto';
import { db, transaction } from './db.ts';
import { STATUS_COLORS, type StatusColor, type StatusDef, type StatusKind } from '../shared/types.ts';

type Row = { key: string; label: string; color: string; kind: StatusKind; position: number; system: number; leads?: number };

const toDef = (r: Row): StatusDef => ({
  key: r.key,
  label: r.label,
  color: (STATUS_COLORS as readonly string[]).includes(r.color) ? (r.color as StatusColor) : 'gray',
  kind: r.kind,
  position: r.position,
  system: Boolean(r.system),
  ...(r.leads !== undefined ? { leads: Number(r.leads) } : {}),
});

export function listStatuses(withCounts = false): StatusDef[] {
  const sql = withCounts
    ? 'SELECT s.*, (SELECT COUNT(*) FROM leads l WHERE l.status = s.key) AS leads FROM lead_statuses s ORDER BY position, label'
    : 'SELECT * FROM lead_statuses ORDER BY position, label';
  return (db.prepare(sql).all() as unknown as Row[]).map(toDef);
}

export function getStatus(key: string): StatusDef | null {
  const r = db.prepare('SELECT * FROM lead_statuses WHERE key = ?').get(key) as Row | undefined;
  return r ? toDef(r) : null;
}

export const statusKind = (key: string): StatusKind | null => getStatus(key)?.kind ?? null;

/** Chaves dos status de um tipo (ex.: todos os "perdido"). */
export function keysOfKind(kind: StatusKind): string[] {
  return (db.prepare('SELECT key FROM lead_statuses WHERE kind = ?').all(kind) as { key: string }[]).map((r) => r.key);
}

/** Status de entrada (onde todo lead novo começa). */
export function entryStatusKey(): string {
  const r = db.prepare("SELECT key FROM lead_statuses WHERE kind = 'new' ORDER BY position LIMIT 1").get() as { key: string } | undefined;
  return r?.key ?? 'NOVO';
}

const KINDS: StatusKind[] = ['open', 'won', 'lost'];

export function statusProblem(b: { label?: unknown; color?: unknown; kind?: unknown }, creating: boolean): string | null {
  if (creating || b.label !== undefined) {
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (!label) return 'Informe o nome do status.';
    if (label.length > 40) return 'Nome longo demais (máximo 40 caracteres).';
  }
  if (b.color !== undefined && !(STATUS_COLORS as readonly string[]).includes(String(b.color))) return 'Cor inválida.';
  if ((creating || b.kind !== undefined) && !KINDS.includes(b.kind as StatusKind)) return 'Escolha o tipo do status.';
  return null;
}

function labelTaken(label: string, exceptKey?: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM lead_statuses WHERE lower(label) = lower(?) AND key != ?').get(label.trim(), exceptKey ?? ''),
  );
}

export function createStatus(b: { label: string; color?: StatusColor; kind: StatusKind }): StatusDef | string {
  if (labelTaken(b.label)) return 'Já existe um status com esse nome.';
  const key = `S_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM lead_statuses').get() as { p: number }).p;
  db.prepare('INSERT INTO lead_statuses (key, label, color, kind, position, system) VALUES (?, ?, ?, ?, ?, 0)').run(
    key,
    b.label.trim(),
    b.color ?? 'gray',
    b.kind,
    pos,
  );
  return getStatus(key)!;
}

export function updateStatus(key: string, b: { label?: string; color?: StatusColor; kind?: StatusKind }): StatusDef | string | null {
  const cur = getStatus(key);
  if (!cur) return null;
  if (b.label !== undefined && labelTaken(b.label, key)) return 'Já existe um status com esse nome.';
  if (b.kind !== undefined && cur.system && b.kind !== cur.kind) return 'O tipo dos status de fábrica não pode ser alterado.';
  db.prepare('UPDATE lead_statuses SET label = ?, color = ?, kind = ? WHERE key = ?').run(
    b.label?.trim() ?? cur.label,
    b.color ?? cur.color,
    b.kind ?? cur.kind,
    key,
  );
  return getStatus(key);
}

/** Reordena conforme a lista de chaves recebida (as ausentes vão para o fim). */
export function reorderStatuses(keys: string[]) {
  transaction(() => {
    const all = listStatuses().map((s) => s.key);
    const order = [...keys.filter((k) => all.includes(k)), ...all.filter((k) => !keys.includes(k))];
    const stmt = db.prepare('UPDATE lead_statuses SET position = ? WHERE key = ?');
    order.forEach((k, i) => stmt.run(i, k));
  });
}

/** Exclui um status criado pela equipe, movendo os leads dele para `moveTo`. */
export function deleteStatus(key: string, moveTo?: string): { moved: number } | string {
  const cur = getStatus(key);
  if (!cur) return 'Status não encontrado.';
  if (cur.system) return 'Status de fábrica não podem ser excluídos. Você pode renomeá-los.';
  const inUse = (db.prepare('SELECT COUNT(*) AS n FROM leads WHERE status = ?').get(key) as { n: number }).n;
  if (inUse > 0) {
    const target = moveTo ? getStatus(moveTo) : null;
    if (!target || target.key === key) return `Há ${inUse} lead(s) neste status. Escolha para qual status movê-los.`;
  }
  return transaction(() => {
    const moved = inUse ? db.prepare('UPDATE leads SET status = ? WHERE status = ?').run(moveTo!, key).changes : 0;
    db.prepare('DELETE FROM lead_statuses WHERE key = ?').run(key);
    return { moved: Number(moved) };
  });
}
