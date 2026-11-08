// Caixas de entrada, investimentos, registro de webhooks e deduplicação de mensagens.

import { db, nowIso } from './db.ts';
import { broadcast } from './events.ts';
import type { Inbox, Investment, WebhookLog } from '../shared/types.ts';

// ---------- Caixas de entrada ----------

type Row = Record<string, unknown>;

const toInbox = (r: Row): Inbox => ({
  id: Number(r.id),
  name: String(r.name),
  channel_type: String(r.channel_type ?? ''),
  enabled: Boolean(r.enabled),
  custom_name: (r.custom_name as string) ?? null,
});

export function listInboxes(): Inbox[] {
  return (db.prepare('SELECT * FROM inboxes ORDER BY name').all() as Row[]).map(toInbox);
}

export function getInbox(id: number): Inbox | null {
  const r = db.prepare('SELECT * FROM inboxes WHERE id = ?').get(id) as Row | undefined;
  return r ? toInbox(r) : null;
}

/** Atualiza nome/tipo vindos do Chatwoot preservando ativação e nome personalizado. */
export function saveRemoteInboxes(list: { id: number; name: string; channel_type: string }[]) {
  const stmt = db.prepare(
    `INSERT INTO inboxes (id, name, channel_type) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_type = excluded.channel_type`,
  );
  for (const ib of list) stmt.run(ib.id, ib.name, ib.channel_type);
}

export function updateInbox(id: number, patch: { enabled?: boolean; custom_name?: string | null }): Inbox | null {
  const current = getInbox(id);
  if (!current) return null;
  const enabled = patch.enabled ?? current.enabled;
  const custom = patch.custom_name === undefined ? current.custom_name : patch.custom_name?.trim() || null;
  db.prepare('UPDATE inboxes SET enabled = ?, custom_name = ? WHERE id = ?').run(enabled ? 1 : 0, custom, id);
  return getInbox(id);
}

export const inboxLabel = (ib: Inbox | null | undefined) => ib?.custom_name || ib?.name || null;

// ---------- Investimentos ----------

const toInvestment = (r: Row): Investment => ({
  id: Number(r.id),
  date: String(r.date),
  amount: Number(r.amount),
  channel: String(r.channel),
  notes: (r.notes as string) ?? null,
  created_at: String(r.created_at),
});

export function listInvestments(): Investment[] {
  return (db.prepare('SELECT * FROM investments ORDER BY date DESC, id DESC').all() as Row[]).map(toInvestment);
}

export function investmentProblem(b: Record<string, unknown>): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? ''))) return 'Informe a data.';
  if (typeof b.amount !== 'number' || !isFinite(b.amount) || b.amount <= 0) return 'Informe um valor maior que zero.';
  return null;
}

export function addInvestment(b: { date: string; amount: number; channel?: string; notes?: string }): Investment {
  const info = db
    .prepare('INSERT INTO investments (date, amount, channel, notes, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(b.date, b.amount, b.channel?.trim() || 'Geral', b.notes?.trim() || null, nowIso());
  return toInvestment(db.prepare('SELECT * FROM investments WHERE id = ?').get(info.lastInsertRowid) as Row);
}

export function updateInvestment(
  id: number,
  b: { date: string; amount: number; channel?: string; notes?: string },
): Investment | null {
  const res = db
    .prepare('UPDATE investments SET date = ?, amount = ?, channel = ?, notes = ? WHERE id = ?')
    .run(b.date, b.amount, b.channel?.trim() || 'Geral', b.notes?.trim() || null, id);
  if (!res.changes) return null;
  return toInvestment(db.prepare('SELECT * FROM investments WHERE id = ?').get(id) as Row);
}

export function deleteInvestment(id: number): boolean {
  return db.prepare('DELETE FROM investments WHERE id = ?').run(id).changes > 0;
}

/** Soma investida entre dois dias (inclusivos, YYYY-MM-DD). */
export function investedBetween(start: string | null, end: string | null): number {
  const r = (
    start && end
      ? db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM investments WHERE date BETWEEN ? AND ?').get(start, end)
      : db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM investments').get()
  ) as { s: number };
  return r.s;
}

export function investedByMonth(): Map<string, number> {
  const rows = db
    .prepare("SELECT substr(date,1,7) AS m, SUM(amount) AS s FROM investments GROUP BY m")
    .all() as { m: string; s: number }[];
  return new Map(rows.map((r) => [r.m, r.s]));
}

// ---------- Webhooks ----------

/** Guarda só os últimos eventos: o suficiente para saber se o webhook está chegando. */
export const MAX_LOGS = 5;

export function logWebhook(e: Omit<WebhookLog, 'id' | 'received_at'>) {
  db.prepare(
    `INSERT INTO webhook_logs (received_at, event, status, summary, conversation_id, contact_name, lead_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(nowIso(), e.event, e.status, e.summary, e.conversation_id, e.contact_name, e.lead_id);
  db.prepare('DELETE FROM webhook_logs WHERE id <= (SELECT MAX(id) FROM webhook_logs) - ?').run(MAX_LOGS);
  broadcast('webhook', { status: e.status });
}

export function listWebhookLogs(limit = MAX_LOGS): WebhookLog[] {
  return db.prepare('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT ?').all(limit) as unknown as WebhookLog[];
}

export function clearWebhookLogs() {
  db.exec('DELETE FROM webhook_logs');
}

/** Marca a mensagem como processada; retorna false se já tinha sido vista. */
export function claimMessage(id: string | number): boolean {
  const res = db.prepare('INSERT OR IGNORE INTO processed_messages (id, at) VALUES (?, ?)').run(String(id), nowIso());
  return res.changes > 0;
}

export function purgeProcessedMessages(days = 30) {
  db.prepare('DELETE FROM processed_messages WHERE at < ?').run(new Date(Date.now() - days * 86400_000).toISOString());
}
