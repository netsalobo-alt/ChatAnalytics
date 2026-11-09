// Backup completo em JSON e importação (backup 3.0 ou dados do ChatAnalytics 2.0).

import { db, nowIso, transaction } from './db.ts';
import { getLead, writeRow } from './leads.ts';
import { getSettings, setSettings, type SettingsShape } from './settings.ts';
import { listInboxes, listInvestments } from './store.ts';
import { cleanCPF, formatCPF, validateCPF } from '../shared/cpf.ts';
import { CHANNELS, LEAD_STATUSES, type Channel, type ClientMessage, type Inbox, type Investment, type LeadDetail, type LeadStatus } from '../shared/types.ts';

type Json = Record<string, any>;

export interface BackupV3 {
  system: 'ChatAnalytics';
  version: 3;
  exported_at: string;
  settings: Partial<SettingsShape>;
  inboxes: Inbox[];
  leads: LeadDetail[];
  investments: Investment[];
}

export function exportBackup(): BackupV3 {
  const { webhook_secret: _secret, last_sync_status: _st, ...settings } = getSettings();
  const ids = (db.prepare('SELECT id FROM leads ORDER BY entry_date').all() as { id: string }[]).map((r) => r.id);
  return {
    system: 'ChatAnalytics',
    version: 3,
    exported_at: nowIso(),
    settings,
    inboxes: listInboxes(),
    leads: ids.map((id) => getLead(id)!).filter(Boolean),
    investments: listInvestments(),
  };
}

// ---------- Normalização ----------

const LEGACY_STATUS: Record<string, LeadStatus> = {
  'NOVO LEAD': 'NOVO',
  'EM ANÁLISE': 'EM_ANALISE',
  PENDENTE: 'PENDENTE',
  APROVADO: 'APROVADO',
  REPROVADO: 'REPROVADO',
  converted: 'APROVADO',
  not_converted: 'REPROVADO',
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const iso = (v: unknown, fallback: string) => {
  const t = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(String(v ?? ''));
  return isFinite(t) && t > 0 ? new Date(t).toISOString() : fallback;
};

/** DD/MM/AAAA a partir de DD/MM/AAAA ou AAAA-MM-DD. */
function birth(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function normalizeLead(raw: Json): LeadDetail | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const now = nowIso();
  const status: LeadStatus = LEAD_STATUSES.includes(raw.status)
    ? raw.status
    : LEGACY_STATUS[raw.status] ?? (raw.is_converted ? 'APROVADO' : 'NOVO');
  const vendeu = Boolean(raw.vendeu ?? raw.is_converted ?? false);
  const cpfClean = cleanCPF(raw.cpf);
  const entry = iso(raw.entry_date ?? raw.first_identified_at ?? raw.created_at, now);
  const origins: Json = {};
  for (const f of ['cpf', 'birth_date', 'cnh']) {
    const o = raw.field_origins?.[f];
    if (o === 'MANUAL' || o === 'LOCAL') origins[f] = o;
    else if (o === 'IA') origins[f] = 'LOCAL';
  }
  const messages: ClientMessage[] = (Array.isArray(raw.recent_messages) ? raw.recent_messages : raw.recent_client_messages ?? [])
    .filter((m: Json) => m && typeof m.text === 'string')
    .map((m: Json) => ({ text: m.text, timestamp: Number(m.timestamp) || Date.parse(entry), message_id: m.message_id }))
    .slice(-50);

  return {
    id: String(raw.id),
    account_id: String(raw.account_id ?? ''),
    contact_id: Number(raw.contact_id) || 0,
    conversation_id: Number(raw.conversation_id) || 0,
    contact_name: str(raw.contact_name) ?? 'Cliente sem nome',
    contact_phone: str(raw.contact_phone) ?? '',
    contact_email: str(raw.contact_email) ?? '',
    entry_date: entry,
    last_interaction_at: iso(raw.last_interaction_at, entry),
    cpf: cpfClean ? (cpfClean.length === 11 ? formatCPF(cpfClean) : cpfClean) : null,
    cpf_valid: cpfClean ? validateCPF(cpfClean) : false,
    birth_date: birth(raw.birth_date),
    cnh: raw.cnh === 'SIM' || raw.cnh === 'NÃO' ? raw.cnh : null,
    status,
    vendedor: str(raw.vendedor),
    loja: str(raw.loja),
    vendeu,
    valor_venda: Math.max(0, Number(raw.valor_venda ?? raw.value ?? 0) || 0),
    sale_date: vendeu ? iso(raw.sale_date ?? raw.conversion_date ?? raw.last_interaction_at, entry) : null,
    observacao: str(raw.observacao),
    motivo_reprovacao: str(raw.motivo_reprovacao),
    veiculo: str(raw.veiculo),
    criativo: str(raw.criativo),
    chatwoot_url: str(raw.chatwoot_url),
    channel: CHANNELS.includes(raw.channel) ? (raw.channel as Channel) : 'Outros',
    inbox_id: raw.inbox_id == null ? null : Number(raw.inbox_id) || null,
    inbox_name: str(raw.inbox_name) ?? str(raw.channel_detail),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === 'string') : [],
    last_message: str(raw.last_message),
    manual_fields: Array.isArray(raw.manual_fields) ? raw.manual_fields.filter((t: unknown) => typeof t === 'string') : [],
    field_origins: origins,
    cpf_conflict: typeof raw.cpf_conflict === 'string' ? raw.cpf_conflict : raw.cpf_conflict ? str(raw.cpf_conflict_detail) ?? 'Conflito de CPF' : null,
    recent_messages: messages,
    created_at: iso(raw.created_at, entry),
    updated_at: now,
  };
}

// ---------- Importação ----------

export interface ImportResult {
  format: 'v3' | 'legacy';
  leads: number;
  investments: number;
  inboxes: number;
  skipped: number;
}

/**
 * Importa um backup. Modo "merge" atualiza/acrescenta; "replace" apaga leads,
 * investimentos e caixas antes. Usuários nunca são alterados.
 */
export function importBackup(data: Json, mode: 'merge' | 'replace'): ImportResult {
  if (!data || typeof data !== 'object') throw new Error('Arquivo inválido.');
  const isV3 = data.system === 'ChatAnalytics' && data.version === 3;
  const legacyLeads = data.leads && !Array.isArray(data.leads) && typeof data.leads === 'object';
  if (!isV3 && !legacyLeads) throw new Error('Formato não reconhecido. Use um backup do ChatAnalytics 2.0 ou 3.0.');

  const rawLeads: Json[] = isV3 ? data.leads : Object.values(data.leads);
  const rawInvestments: Json[] = Array.isArray(data.investments) ? data.investments : [];
  const rawInboxes: Json[] = isV3 ? data.inboxes ?? [] : data.config?.inboxes ?? [];

  return transaction(() => {
    if (mode === 'replace') db.exec('DELETE FROM leads; DELETE FROM investments; DELETE FROM inboxes;');

    let inboxes = 0;
    const ibStmt = db.prepare(
      `INSERT INTO inboxes (id, name, channel_type, enabled, custom_name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_type = excluded.channel_type,
         enabled = excluded.enabled, custom_name = excluded.custom_name`,
    );
    for (const ib of rawInboxes) {
      if (!Number(ib?.id)) continue;
      ibStmt.run(Number(ib.id), String(ib.name ?? `Caixa ${ib.id}`), String(ib.channel_type ?? ''), ib.enabled === false ? 0 : 1, str(ib.custom_name));
      inboxes++;
    }

    let leads = 0;
    let skipped = 0;
    for (const raw of rawLeads) {
      const lead = normalizeLead(raw);
      if (!lead) {
        skipped++;
        continue;
      }
      writeRow(lead);
      leads++;
    }

    let investments = 0;
    const exists = db.prepare('SELECT 1 FROM investments WHERE date = ? AND amount = ? AND channel = ?');
    const ins = db.prepare('INSERT INTO investments (date, amount, channel, notes, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const inv of rawInvestments) {
      const date = String(inv?.date ?? '').slice(0, 10);
      const amount = Number(inv?.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0)) {
        skipped++;
        continue;
      }
      const channel = str(inv.channel) ?? 'Geral';
      if (mode === 'merge' && exists.get(date, amount, channel)) continue;
      ins.run(date, amount, channel, str(inv.notes), iso(inv.created_at, nowIso()));
      investments++;
    }

    // Conexão com o Chatwoot: só preenche o que ainda está vazio, para não trocar uma conexão ativa.
    const cfg: Json = isV3 ? data.settings ?? {} : data.config ?? {};
    const current = getSettings();
    const fill: Partial<SettingsShape> = {};
    if (!current.chatwoot_url && str(cfg.chatwoot_url)) fill.chatwoot_url = String(cfg.chatwoot_url).replace(/\/+$/, '');
    if (!current.account_id && cfg.account_id) fill.account_id = String(cfg.account_id);
    if (!current.api_token && str(cfg.api_token) && !String(cfg.api_token).includes('••')) fill.api_token = String(cfg.api_token);
    if (isV3) {
      if (str(cfg.labels_on_approve)) fill.labels_on_approve = cfg.labels_on_approve;
      if (str(cfg.labels_on_reject)) fill.labels_on_reject = cfg.labels_on_reject;
    }
    setSettings(fill);

    return { format: isV3 ? 'v3' : 'legacy', leads, investments, inboxes, skipped };
  });
}
