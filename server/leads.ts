// Repositório de leads: gravação vinda do Chatwoot, edição manual do SDR, consultas e exportação.

import crypto from 'node:crypto';
import { db, nowIso, transaction } from './db.ts';
import { extractClientData } from '../shared/extractor.ts';
import { cleanCPF, formatCPF, validateCPF } from '../shared/cpf.ts';
import { rangeForPeriod, rangeToIso } from '../shared/dates.ts';
import {
  LEAD_STATUSES,
  type Channel,
  type ClientMessage,
  type Lead,
  type LeadDetail,
  type LeadStatus,
  type Paged,
  type Period,
} from '../shared/types.ts';

type Row = Record<string, unknown>;

const json = <T>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
};

function toLead(r: Row): Lead {
  return {
    id: String(r.id),
    account_id: String(r.account_id),
    contact_id: Number(r.contact_id),
    conversation_id: Number(r.conversation_id),
    contact_name: String(r.contact_name ?? ''),
    contact_phone: String(r.contact_phone ?? ''),
    contact_email: String(r.contact_email ?? ''),
    entry_date: String(r.entry_date),
    last_interaction_at: String(r.last_interaction_at),
    cpf: (r.cpf as string) ?? null,
    cpf_valid: Boolean(r.cpf_valid),
    birth_date: (r.birth_date as string) ?? null,
    cnh: (r.cnh as Lead['cnh']) ?? null,
    status: r.status as LeadStatus,
    vendedor: (r.vendedor as string) ?? null,
    loja: (r.loja as string) ?? null,
    vendeu: Boolean(r.vendeu),
    valor_venda: Number(r.valor_venda ?? 0),
    sale_date: (r.sale_date as string) ?? null,
    observacao: (r.observacao as string) ?? null,
    motivo_reprovacao: (r.motivo_reprovacao as string) ?? null,
    chatwoot_url: (r.chatwoot_url as string) ?? null,
    channel: r.channel as Channel,
    inbox_id: r.inbox_id == null ? null : Number(r.inbox_id),
    inbox_name: (r.inbox_name as string) ?? null,
    tags: json<string[]>(r.tags, []),
    last_message: (r.last_message as string) ?? null,
    manual_fields: json<string[]>(r.manual_fields, []),
    field_origins: json(r.field_origins, {}),
    cpf_conflict: (r.cpf_conflict as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

const COLUMNS = [
  'id', 'account_id', 'contact_id', 'conversation_id', 'contact_name', 'contact_phone', 'contact_email',
  'entry_date', 'last_interaction_at', 'cpf', 'cpf_valid', 'birth_date', 'cnh', 'status', 'vendedor', 'loja',
  'vendeu', 'valor_venda', 'sale_date', 'observacao', 'motivo_reprovacao', 'chatwoot_url', 'channel',
  'inbox_id', 'inbox_name', 'tags', 'last_message', 'manual_fields', 'field_origins', 'cpf_conflict',
  'recent_messages', 'created_at', 'updated_at',
] as const;

export function writeRow(lead: LeadDetail) {
  const values: Record<string, unknown> = {
    ...lead,
    cpf_valid: lead.cpf_valid ? 1 : 0,
    vendeu: lead.vendeu ? 1 : 0,
    tags: JSON.stringify(lead.tags),
    manual_fields: JSON.stringify(lead.manual_fields),
    field_origins: JSON.stringify(lead.field_origins),
    recent_messages: JSON.stringify(lead.recent_messages),
  };
  const params = COLUMNS.map((c) => (values[c] ?? null) as string | number | null);
  db.prepare(
    `INSERT INTO leads (${COLUMNS.join(',')}) VALUES (${COLUMNS.map(() => '?').join(',')})
     ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).run(...params);
}

export function getLead(id: string): LeadDetail | null {
  const r = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Row | undefined;
  return r ? { ...toLead(r), recent_messages: json<ClientMessage[]>(r.recent_messages, []) } : null;
}

// ---------- Entrada a partir do Chatwoot ----------

export interface ChatwootLeadInput {
  account_id: string;
  contact_id: number;
  conversation_id: number;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  channel: Channel;
  inbox_id?: number | null;
  inbox_name?: string | null;
  tags?: string[];
  entry_date: string;
  last_interaction_at: string;
  chatwoot_url?: string | null;
  messages?: ClientMessage[];
  /** Janela da extração. Padrão 10 min (webhook); Infinity para reanálise do histórico. */
  extract_window_ms?: number;
}

function mergeMessages(current: ClientMessage[], incoming: ClientMessage[]): ClientMessage[] {
  const out = [...current];
  for (const m of incoming) {
    if (!m.text) continue;
    const dup = out.some(
      (o) =>
        (m.message_id != null && o.message_id === m.message_id) ||
        (o.text === m.text && Math.abs(o.timestamp - m.timestamp) < 2000),
    );
    if (!dup) out.push(m);
  }
  return out.sort((a, b) => a.timestamp - b.timestamp).slice(-50);
}

export function upsertFromChatwoot(input: ChatwootLeadInput): { lead: LeadDetail; isNew: boolean; found: string[] } {
  return transaction(() => {
    const id = `${input.account_id}_${input.contact_id}`;
    let existing = getLead(id);
    if (!existing && input.contact_phone) {
      const r = db
        .prepare('SELECT id FROM leads WHERE account_id = ? AND contact_phone = ? LIMIT 1')
        .get(input.account_id, input.contact_phone) as { id: string } | undefined;
      if (r) existing = getLead(r.id);
    }
    const now = nowIso();
    const manual = new Set(existing?.manual_fields ?? []);
    const messages = mergeMessages(existing?.recent_messages ?? [], input.messages ?? []);
    const extracted = extractClientData(messages, existing ?? {}, { windowMs: input.extract_window_ms });

    const found: string[] = [];
    if (extracted.cpf && extracted.cpf !== existing?.cpf) found.push('CPF');
    if (extracted.birth_date && extracted.birth_date !== existing?.birth_date) found.push('nascimento');
    if (extracted.cnh && extracted.cnh !== existing?.cnh) found.push('CNH');

    const lastIncoming = input.messages?.length ? input.messages[input.messages.length - 1].text : undefined;
    const keep = <K extends keyof Lead>(field: K, value: Lead[K] | undefined): Lead[K] =>
      existing && (manual.has(field) || value === undefined || value === '') ? existing[field] : (value as Lead[K]);

    const lead: LeadDetail = {
      id: existing?.id ?? id,
      account_id: input.account_id,
      contact_id: existing?.contact_id ?? input.contact_id,
      conversation_id: input.conversation_id || existing?.conversation_id || 0,
      contact_name: keep('contact_name', input.contact_name) || 'Cliente sem nome',
      contact_phone: keep('contact_phone', input.contact_phone) ?? '',
      contact_email: keep('contact_email', input.contact_email) ?? '',
      entry_date:
        existing && existing.entry_date < input.entry_date ? existing.entry_date : input.entry_date,
      last_interaction_at:
        existing && existing.last_interaction_at > input.last_interaction_at
          ? existing.last_interaction_at
          : input.last_interaction_at,
      cpf: extracted.cpf,
      cpf_valid: extracted.cpf_valid,
      birth_date: extracted.birth_date,
      cnh: extracted.cnh,
      cpf_conflict: extracted.cpf_conflict ?? existing?.cpf_conflict ?? null,
      field_origins: extracted.field_origins,
      status: existing?.status ?? 'NOVO',
      vendedor: existing?.vendedor ?? null,
      loja: existing?.loja ?? null,
      vendeu: existing?.vendeu ?? false,
      valor_venda: existing?.valor_venda ?? 0,
      sale_date: existing?.sale_date ?? null,
      observacao: existing?.observacao ?? null,
      motivo_reprovacao: existing?.motivo_reprovacao ?? null,
      chatwoot_url: input.chatwoot_url ?? existing?.chatwoot_url ?? null,
      channel: input.channel,
      inbox_id: input.inbox_id ?? existing?.inbox_id ?? null,
      inbox_name: input.inbox_name ?? existing?.inbox_name ?? null,
      tags: input.tags ?? existing?.tags ?? [],
      last_message: lastIncoming ?? existing?.last_message ?? null,
      manual_fields: [...manual],
      recent_messages: messages,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    writeRow(lead);
    return { lead, isNew: !existing, found };
  });
}

// ---------- Edição manual (SDR) ----------

export interface LeadPatch {
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  cpf?: string | null;
  birth_date?: string | null;
  cnh?: 'SIM' | 'NÃO' | null;
  status?: LeadStatus;
  vendedor?: string | null;
  loja?: string | null;
  vendeu?: boolean;
  valor_venda?: number;
  observacao?: string | null;
  motivo_reprovacao?: string | null;
}

const MANUAL_TRACKED = ['contact_name', 'contact_phone', 'contact_email', 'cpf', 'birth_date', 'cnh'] as const;

export function validatePatch(p: Record<string, unknown>): string | null {
  if (p.status !== undefined && !LEAD_STATUSES.includes(p.status as LeadStatus)) return 'Status inválido.';
  if (p.cnh !== undefined && p.cnh !== null && p.cnh !== 'SIM' && p.cnh !== 'NÃO') return 'CNH deve ser SIM ou NÃO.';
  if (p.valor_venda !== undefined && (typeof p.valor_venda !== 'number' || p.valor_venda < 0 || !isFinite(p.valor_venda)))
    return 'Valor de venda inválido.';
  if (p.birth_date && !/^\d{2}\/\d{2}\/\d{4}$/.test(String(p.birth_date))) return 'Use a data no formato DD/MM/AAAA.';
  if (p.cpf && cleanCPF(String(p.cpf)).length !== 11) return 'O CPF precisa ter 11 dígitos.';
  return null;
}

export function updateLead(id: string, patch: LeadPatch): LeadDetail | null {
  return transaction(() => {
    const lead = getLead(id);
    if (!lead) return null;
    const manual = new Set(lead.manual_fields);
    const origins = { ...lead.field_origins };

    for (const f of MANUAL_TRACKED) {
      if (patch[f] !== undefined) {
        manual.add(f);
        if (f === 'cpf' || f === 'birth_date' || f === 'cnh') origins[f] = 'MANUAL';
      }
    }
    const next: LeadDetail = { ...lead };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() || null : v;
    }
    if (patch.contact_name !== undefined) next.contact_name = patch.contact_name.trim() || lead.contact_name;
    next.contact_phone ??= '';
    next.contact_email ??= '';
    if (patch.cpf !== undefined) {
      const clean = cleanCPF(patch.cpf);
      next.cpf = clean ? formatCPF(clean) : null;
      next.cpf_valid = clean ? validateCPF(clean) : false;
      next.cpf_conflict = null;
    }
    if (patch.vendeu !== undefined) {
      next.sale_date = patch.vendeu ? (lead.sale_date ?? nowIso()) : null;
      if (!patch.vendeu && patch.valor_venda === undefined) next.valor_venda = 0;
    }
    if (patch.status === 'APROVADO' && patch.vendeu === undefined && !lead.vendeu) {
      next.vendeu = true;
      next.sale_date = nowIso();
    }
    if (patch.status && patch.status !== 'REPROVADO' && patch.motivo_reprovacao === undefined) next.motivo_reprovacao = null;
    if (patch.status === 'REPROVADO' && patch.vendeu === undefined) {
      next.vendeu = false;
      next.sale_date = null;
      next.valor_venda = 0;
    }
    next.manual_fields = [...manual];
    next.field_origins = origins;
    next.updated_at = nowIso();
    writeRow(next);
    return next;
  });
}

/** Grava o resultado de uma reanálise do histórico da conversa. */
export function applyRescan(id: string, messages: ClientMessage[]): { lead: LeadDetail; found: string[] } | null {
  const lead = getLead(id);
  if (!lead) return null;
  const merged = mergeMessages(lead.recent_messages, messages);
  const extracted = extractClientData(merged, lead, { windowMs: Infinity, maxMessages: 200 });
  const found: string[] = [];
  if (extracted.cpf && extracted.cpf !== lead.cpf) found.push('CPF');
  if (extracted.birth_date && extracted.birth_date !== lead.birth_date) found.push('nascimento');
  if (extracted.cnh && extracted.cnh !== lead.cnh) found.push('CNH');
  const next: LeadDetail = {
    ...lead,
    ...extracted,
    cpf_conflict: extracted.cpf_conflict ?? lead.cpf_conflict,
    recent_messages: merged,
    updated_at: nowIso(),
  };
  writeRow(next);
  return { lead: next, found };
}

export function createManualLead(input: {
  account_id: string;
  contact_name: string;
  contact_phone: string;
  contact_email?: string;
  channel: Channel;
  inbox_id?: number | null;
  inbox_name?: string | null;
}): LeadDetail {
  const now = nowIso();
  const lead: LeadDetail = {
    id: `manual_${crypto.randomUUID()}`,
    account_id: input.account_id || 'manual',
    contact_id: 0,
    conversation_id: 0,
    contact_name: input.contact_name.trim(),
    contact_phone: input.contact_phone.trim(),
    contact_email: input.contact_email?.trim() ?? '',
    entry_date: now,
    last_interaction_at: now,
    cpf: null,
    cpf_valid: false,
    birth_date: null,
    cnh: null,
    status: 'NOVO',
    vendedor: null,
    loja: null,
    vendeu: false,
    valor_venda: 0,
    sale_date: null,
    observacao: null,
    motivo_reprovacao: null,
    chatwoot_url: null,
    channel: input.channel,
    inbox_id: input.inbox_id ?? null,
    inbox_name: input.inbox_name ?? null,
    tags: [],
    last_message: null,
    manual_fields: ['contact_name', 'contact_phone', 'contact_email'],
    field_origins: {},
    cpf_conflict: null,
    recent_messages: [],
    created_at: now,
    updated_at: now,
  };
  writeRow(lead);
  return lead;
}

export function deleteLead(id: string): boolean {
  return db.prepare('DELETE FROM leads WHERE id = ?').run(id).changes > 0;
}

// ---------- Consultas ----------

export interface LeadQuery {
  period?: Period;
  start?: string;
  end?: string;
  status?: LeadStatus;
  inbox_id?: number;
  channel?: Channel;
  vendeu?: boolean;
  conflict?: boolean;
  /** 'com' = CPF válido capturado; 'sem' = sem CPF válido. */
  cpf?: 'com' | 'sem';
  search?: string;
  page?: number;
  page_size?: number;
  sort?: 'entry_date' | 'last_interaction_at' | 'valor_venda' | 'contact_name';
  dir?: 'asc' | 'desc';
}

function buildWhere(q: LeadQuery): { sql: string; params: (string | number)[] } {
  const where: string[] = ['(inbox_id IS NULL OR inbox_id NOT IN (SELECT id FROM inboxes WHERE enabled = 0))'];
  const params: (string | number)[] = [];
  const range = q.period ? rangeForPeriod(q.period, { start: q.start, end: q.end }) : null;
  if (range) {
    const { from, to } = rangeToIso(range);
    where.push('entry_date >= ? AND entry_date < ?');
    params.push(from, to);
  }
  if (q.status) (where.push('status = ?'), params.push(q.status));
  if (q.inbox_id) (where.push('inbox_id = ?'), params.push(q.inbox_id));
  if (q.channel) (where.push('channel = ?'), params.push(q.channel));
  if (q.vendeu !== undefined) (where.push('vendeu = ?'), params.push(q.vendeu ? 1 : 0));
  if (q.conflict) where.push('cpf_conflict IS NOT NULL');
  if (q.cpf === 'com') where.push('cpf IS NOT NULL AND cpf_valid = 1');
  if (q.cpf === 'sem') where.push('(cpf IS NULL OR cpf_valid = 0)');
  if (q.search?.trim()) {
    const s = q.search.trim();
    const digits = s.replace(/\D/g, '');
    const clauses = ['contact_name LIKE ?', 'contact_email LIKE ?', 'vendedor LIKE ?'];
    params.push(`%${s}%`, `%${s}%`, `%${s}%`);
    if (digits.length >= 3) {
      clauses.push("REPLACE(REPLACE(REPLACE(REPLACE(contact_phone,'+',''),' ',''),'-',''),'(','') LIKE ?");
      clauses.push("REPLACE(REPLACE(cpf,'.',''),'-','') LIKE ?");
      params.push(`%${digits}%`, `%${digits}%`);
    }
    where.push(`(${clauses.join(' OR ')})`);
  }
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

export function listLeads(q: LeadQuery): Paged<Lead> {
  const { sql, params } = buildWhere(q);
  const page = Math.max(1, q.page ?? 1);
  const size = Math.min(200, Math.max(1, q.page_size ?? 25));
  const sort = ['entry_date', 'last_interaction_at', 'valor_venda', 'contact_name'].includes(q.sort ?? '')
    ? q.sort
    : 'entry_date';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM leads ${sql}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM leads ${sql} ORDER BY ${sort} ${dir}, id LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size) as Row[];
  return { items: rows.map(toLead), total, page, page_size: size };
}

export function allLeadsFor(q: LeadQuery): Lead[] {
  const { sql, params } = buildWhere(q);
  return (db.prepare(`SELECT * FROM leads ${sql} ORDER BY entry_date DESC`).all(...params) as Row[]).map(toLead);
}

export function leadFacets(): { vendedores: string[]; lojas: string[] } {
  const pick = (col: string) =>
    (db.prepare(`SELECT DISTINCT ${col} AS v FROM leads WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY 1`).all() as {
      v: string;
    }[]).map((r) => r.v);
  return { vendedores: pick('vendedor'), lojas: pick('loja') };
}
