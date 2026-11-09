// Integração com o Chatwoot: cliente da API, sincronização completa, webhook e etiquetas.

import { getSettings, setSettings, chatwootReady, parseLabels, type SettingsShape } from './settings.ts';
import { claimMessage, getInbox, inboxLabel, logWebhook, saveRemoteInboxes } from './store.ts';
import { broadcast } from './events.ts';
import { applyRescan, getLead, upsertFromChatwoot } from './leads.ts';
import type { BackfillStatus, Channel, ClientMessage, Lead } from '../shared/types.ts';
import { parseAdMessage, type AdInfo } from '../shared/adParser.ts';
import { db } from './db.ts';

type Json = Record<string, any>;

// ---------- Cliente HTTP ----------

export class ChatwootError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function base(url: string) {
  return url.trim().replace(/\/+$/, '');
}

async function api(s: Pick<SettingsShape, 'chatwoot_url' | 'account_id' | 'api_token'>, path: string, init: RequestInit = {}) {
  const url = `${base(s.chatwoot_url)}/api/v1/accounts/${encodeURIComponent(s.account_id)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { api_access_token: s.api_token, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ChatwootError(`Não foi possível acessar o Chatwoot (${(err as Error).message}).`);
  }
  if (res.status === 401) throw new ChatwootError('Token de acesso recusado pelo Chatwoot.', 401);
  if (res.status === 404) throw new ChatwootError('Conta não encontrada. Confira o Account ID.', 404);
  if (!res.ok) throw new ChatwootError(`O Chatwoot respondeu com erro ${res.status}.`, res.status);
  return (await res.json()) as Json;
}

// ---------- Mapeamentos ----------

export function resolveChannel(channelType = '', inboxName = ''): Channel {
  const t = channelType.toLowerCase();
  const n = inboxName.toLowerCase();
  if (t.includes('whatsapp') || /whats|zap|wpp/.test(n)) return 'WhatsApp';
  if (t.includes('instagram') || /instagram|\big\b/.test(n)) return 'Instagram';
  if (t.includes('facebook') || /facebook|messenger|\bfb\b/.test(n)) return 'Facebook';
  if (t.includes('webwidget') || /site|webchat|widget/.test(n)) return 'Webchat';
  // Caixas "API" costumam ser WhatsApp via WAHA/Evolution.
  if (t.includes('api')) return 'WhatsApp';
  return 'Outros';
}

function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  if (typeof v === 'string' && v) {
    const t = Date.parse(v.includes('T') ? v : v.replace(' UTC', 'Z').replace(' ', 'T'));
    return isNaN(t) ? null : t;
  }
  return null;
}

const labelsOf = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map((l) => (typeof l === 'string' ? l : l?.title || l?.name || '')).filter(Boolean) : [];

/** Mensagens públicas enviadas pelo cliente. */
function clientMessages(list: Json[]): ClientMessage[] {
  const out: ClientMessage[] = [];
  for (const m of list) {
    const text = typeof m.content === 'string' ? m.content.trim() : '';
    if (!text || m.private) continue;
    const incoming = m.message_type === 0 || m.message_type === 'incoming';
    const senderType = String(m.sender_type || m.sender?.type || '').toLowerCase();
    if (!incoming && senderType !== 'contact') continue;
    // Mensagem de anúncio: só a parte escrita pelo cliente entra na extração de dados.
    const ad = parseAdMessage(text);
    const clientText = ad ? ad.clientText : text;
    if (!clientText) continue;
    out.push({ text: clientText, timestamp: toEpochMs(m.created_at) ?? Date.now(), message_id: m.id });
  }
  return out;
}

/** Primeiro anúncio encontrado nas mensagens (ordem cronológica), com a imagem anexada. */
function findAd(list: Json[]): (AdInfo & { image: string | null }) | null {
  const sorted = [...list].sort((a, b) => (toEpochMs(a.created_at) ?? 0) - (toEpochMs(b.created_at) ?? 0));
  for (const m of sorted) {
    if (m.private || typeof m.content !== 'string') continue;
    const parsed = parseAdMessage(m.content);
    if (!parsed?.ad.id) continue;
    const img = (m.attachments ?? []).find((a: Json) => a?.file_type === 'image');
    return { ...parsed.ad, image: img?.data_url ?? img?.thumb_url ?? null };
  }
  return null;
}

function conversationUrl(s: SettingsShape, conversationId: number) {
  return conversationId ? `${base(s.chatwoot_url)}/app/accounts/${s.account_id}/conversations/${conversationId}` : null;
}

// ---------- Ações ----------

export async function testConnection(s: Pick<SettingsShape, 'chatwoot_url' | 'account_id' | 'api_token'>) {
  const data = await api(s, '/inboxes');
  const inboxes = (data.payload ?? []) as Json[];
  return inboxes.map((ib) => ({ id: Number(ib.id), name: String(ib.name ?? `Caixa ${ib.id}`), channel_type: String(ib.channel_type ?? '') }));
}

export async function refreshInboxes() {
  const s = getSettings();
  const list = await testConnection(s);
  saveRemoteInboxes(list);
  return list;
}

let syncing = false;
export const isSyncing = () => syncing;

/**
 * Percorre as conversas do Chatwoot (mais recentes primeiro) e grava os leads.
 * Na primeira vez lê todo o histórico; depois para quando encontra conversas sem atividade
 * desde a última sincronização (com margem de 1 h).
 */
export async function syncConversations(opts: { full?: boolean } = {}): Promise<{ conversations: number; created: number; message: string }> {
  const s = getSettings();
  if (!chatwootReady(s)) throw new ChatwootError('Configure a conexão com o Chatwoot primeiro.');
  if (syncing) throw new ChatwootError('Já existe uma sincronização em andamento.');
  syncing = true;
  setSettings({ last_sync_status: 'syncing' });

  const since = !opts.full && s.last_sync_at ? Date.parse(s.last_sync_at) - 3600_000 : 0;
  let conversations = 0;
  let created = 0;
  try {
    try {
      await refreshInboxes();
    } catch {
      /* segue com as caixas já salvas */
    }
    for (let page = 1; page <= 2000; page++) {
      const data = await api(s, `/conversations?status=all&assignee_type=all&sort_by=last_activity_at_desc&page=${page}`);
      const list = (data.data?.payload ?? data.payload ?? []) as Json[];
      if (!list.length) break;
      let reachedOld = false;
      for (const conv of list) {
        const activity = toEpochMs(conv.last_activity_at ?? conv.timestamp ?? conv.created_at) ?? Date.now();
        if (since && activity < since) {
          reachedOld = true;
          continue;
        }
        if (ingestConversation(s, conv)) created++;
        conversations++;
      }
      if (reachedOld) break;
    }
    const message = `${conversations} conversas lidas, ${created} novos leads.`;
    setSettings({ last_sync_at: new Date().toISOString(), last_sync_status: 'success', last_sync_message: message });
    broadcast('sync', { conversations, created });
    return { conversations, created, message };
  } catch (err) {
    setSettings({ last_sync_status: 'error', last_sync_message: (err as Error).message });
    throw err;
  } finally {
    syncing = false;
  }
}

/** Grava uma conversa da listagem. Retorna true quando cria um lead novo. */
function ingestConversation(s: SettingsShape, conv: Json): boolean {
  const inboxId = Number(conv.inbox_id) || null;
  const inbox = inboxId ? getInbox(inboxId) : null;
  if (inbox && !inbox.enabled) return false;
  const sender = conv.meta?.sender ?? {};
  const contactId = Number(sender.id ?? conv.contact_inbox?.contact_id ?? 0);
  if (!contactId) return false;
  const created = toEpochMs(conv.created_at) ?? Date.now();
  const activity = toEpochMs(conv.last_activity_at ?? conv.timestamp) ?? created;
  const name = inboxLabel(inbox);
  const { isNew } = upsertFromChatwoot({
    account_id: String(s.account_id),
    contact_id: contactId,
    conversation_id: Number(conv.id),
    contact_name: sender.name,
    contact_phone: sender.phone_number ?? '',
    contact_email: sender.email ?? '',
    channel: resolveChannel(inbox?.channel_type ?? conv.meta?.channel ?? '', name ?? ''),
    inbox_id: inboxId,
    inbox_name: name,
    tags: labelsOf(conv.labels),
    entry_date: new Date(created).toISOString(),
    last_interaction_at: new Date(activity).toISOString(),
    chatwoot_url: conversationUrl(s, Number(conv.id)),
    messages: clientMessages(conv.messages ?? []),
    ad: findAd(conv.messages ?? []),
  });
  return isNew;
}

/** Lê todas as mensagens da conversa do lead e reaplica a extração de CPF, nascimento e CNH. */
export async function rescanLead(id: string) {
  const s = getSettings();
  const lead = getLead(id);
  if (!lead) return null;
  let messages: ClientMessage[] = [];
  let ad: ReturnType<typeof findAd> = null;
  if (chatwootReady(s) && lead.conversation_id) {
    const all: Json[] = [];
    let before: number | undefined;
    for (let i = 0; i < 20; i++) {
      const data = await api(s, `/conversations/${lead.conversation_id}/messages${before ? `?before=${before}` : ''}`);
      const batch = (data.payload ?? []) as Json[];
      if (!batch.length) break;
      all.push(...batch);
      const minId = Math.min(...batch.map((m) => Number(m.id)));
      if (!isFinite(minId) || minId === before) break;
      before = minId;
      if (batch.length < 20) break;
    }
    messages = clientMessages(all);
    ad = findAd(all);
  }
  return applyRescan(id, messages, ad);
}

/** Acrescenta/remove etiquetas na conversa sem apagar as demais. */
export async function applyLabels(lead: Lead, add: string[], remove: string[] = []) {
  const s = getSettings();
  if (!chatwootReady(s) || !lead.conversation_id || (!add.length && !remove.length)) return;
  const current = labelsOf((await api(s, `/conversations/${lead.conversation_id}/labels`)).payload);
  const drop = new Set(remove.map((l) => l.toLowerCase()));
  const next = [...new Set([...current.filter((l) => !drop.has(l.toLowerCase())), ...add])];
  await api(s, `/conversations/${lead.conversation_id}/labels`, { method: 'POST', body: JSON.stringify({ labels: next }) });
}

export function labelsForStatus(status: 'APROVADO' | 'REPROVADO') {
  const s = getSettings();
  const approve = parseLabels(s.labels_on_approve);
  const reject = parseLabels(s.labels_on_reject);
  return status === 'APROVADO' ? { add: approve, remove: reject } : { add: reject, remove: approve };
}

// ---------- Webhook ----------

/**
 * Processa um evento do Chatwoot. Aceita `message_created/updated` (payload = mensagem)
 * e `conversation_*` (payload = conversa).
 */
export function handleWebhook(body: Json): { status: 'processed' | 'ignored'; summary: string; lead_id?: string } {
  const s = getSettings();
  const event = String(body?.event ?? 'desconhecido');
  const isMessage = event.startsWith('message_');
  const conv: Json = isMessage ? (body.conversation ?? {}) : body;
  const conversationId = Number(conv.id ?? body.conversation_id ?? 0);
  const sender: Json = (isMessage && body.sender?.type !== 'user' ? body.sender : null) ?? conv.meta?.sender ?? conv.contact ?? {};
  const contactName: string | null = sender.name ?? null;

  const log = (status: 'processed' | 'ignored', summary: string, lead_id: string | null = null) => {
    logWebhook({ event, status, summary, conversation_id: conversationId || null, contact_name: contactName, lead_id });
    return { status, summary, lead_id: lead_id ?? undefined };
  };

  if (!event.startsWith('message_') && !event.startsWith('conversation_')) return log('ignored', 'Evento não utilizado.');
  if (isMessage && (body.private || (body.message_type !== 'incoming' && body.message_type !== 0)))
    return log('ignored', 'Mensagem do atendente ou nota privada.');
  if (isMessage && body.id != null && event === 'message_created' && !claimMessage(body.id))
    return log('ignored', 'Mensagem já processada.');

  const inboxId = Number(conv.inbox_id ?? body.inbox?.id ?? 0) || null;
  const inbox = inboxId ? getInbox(inboxId) : null;
  if (inbox && !inbox.enabled) return log('ignored', `Caixa "${inboxLabel(inbox)}" está desativada.`);

  const contactId = Number(sender.id ?? conv.contact_inbox?.contact_id ?? 0);
  if (!contactId) return log('ignored', 'Evento sem contato identificado.');

  const name = inboxLabel(inbox) ?? body.inbox?.name ?? null;
  const created = toEpochMs(conv.created_at) ?? Date.now();
  const at = toEpochMs(isMessage ? body.created_at : conv.last_activity_at ?? conv.timestamp) ?? Date.now();
  const messages = isMessage ? clientMessages([body]) : clientMessages(conv.messages ?? []);
  const ad = isMessage ? findAd([body]) : findAd(conv.messages ?? []);
  const accountId = String(body.account?.id ?? conv.account_id ?? s.account_id ?? '');

  const { lead, isNew, found } = upsertFromChatwoot({
    account_id: accountId,
    contact_id: contactId,
    conversation_id: conversationId,
    contact_name: sender.name,
    contact_phone: sender.phone_number ?? '',
    contact_email: sender.email ?? '',
    channel: resolveChannel(inbox?.channel_type ?? body.inbox?.channel_type ?? conv.channel ?? '', name ?? ''),
    inbox_id: inboxId,
    inbox_name: name,
    tags: conv.labels ? labelsOf(conv.labels) : undefined,
    entry_date: new Date(Math.min(created, at)).toISOString(),
    last_interaction_at: new Date(at).toISOString(),
    chatwoot_url: conversationUrl({ ...s, account_id: accountId }, conversationId),
    messages,
    ad,
  });

  const parts = [isNew ? 'Novo lead criado' : 'Lead atualizado'];
  if (found.length) parts.push(`${found.join(', ')} identificado`);
  if (lead.cpf_conflict) parts.push('conflito de CPF');
  return log('processed', parts.join(' · '), lead.id);
}

// ---------- Reprocessar leads antigos (anúncio + dados do cliente) ----------

const backfill: BackfillStatus = {
  running: false, total: 0, done: 0, found: 0, errors: 0, started_at: null, finished_at: null, message: null,
};
export const backfillStatus = () => ({ ...backfill });

/**
 * Relê o histórico das conversas dos leads sem anúncio identificado (últimos `days` dias)
 * para preencher o anúncio de origem e completar CPF, nascimento e CNH. Roda em segundo plano.
 */
export function startBackfill(days = 90): BackfillStatus {
  if (backfill.running) return backfillStatus();
  if (!chatwootReady()) throw new ChatwootError('Configure a conexão com o Chatwoot primeiro.');
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const ids = (db
    .prepare(
      `SELECT id FROM leads WHERE ad_id IS NULL AND conversation_id > 0 AND entry_date >= ?
       ORDER BY entry_date DESC`,
    )
    .all(since) as { id: string }[]).map((r) => r.id);

  Object.assign(backfill, {
    running: true, total: ids.length, done: 0, found: 0, errors: 0,
    started_at: new Date().toISOString(), finished_at: null, message: null,
  });
  broadcast('backfill', backfillStatus());

  (async () => {
    for (const id of ids) {
      try {
        const r = await rescanLead(id);
        if (r?.found.includes('anúncio')) backfill.found++;
      } catch {
        backfill.errors++;
      }
      backfill.done++;
      if (backfill.done % 10 === 0) broadcast('backfill', backfillStatus());
      await new Promise((res) => setTimeout(res, 150)); // não sobrecarrega o Chatwoot
    }
    backfill.running = false;
    backfill.finished_at = new Date().toISOString();
    backfill.message = `${backfill.done} conversas relidas, ${backfill.found} vindas de anúncio.`;
    broadcast('backfill', backfillStatus());
    broadcast('sync', { backfill: true });
  })();

  return backfillStatus();
}
