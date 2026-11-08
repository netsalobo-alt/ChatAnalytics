// Rotas da API. Todas exigem sessão, exceto login, configuração inicial e o webhook (protegido por segredo na URL).

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  activeAdminCount, clearLoginFailures, createFirstAdmin, createUser, endSession, findUserByEmail, hashPassword,
  listUsers, loginBlocked, passwordProblem, registerLoginFailure, requireRole, revokeUserSessions, startSession,
  userCount, verifyPassword,
} from './auth.ts';
import { db } from './db.ts';
import { computeAnalytics } from './analytics.ts';
import { computeReport } from './reports.ts';
import { exportBackup, importBackup } from './backup.ts';
import {
  ChatwootError, applyLabels, handleWebhook, isSyncing, labelsForStatus, refreshInboxes, rescanLead, syncConversations,
  testConnection,
} from './chatwoot.ts';
import {
  allLeadsFor, createManualLead, deleteLead, getLead, leadFacets, listLeads, updateLead, validatePatch,
  type LeadPatch, type LeadQuery,
} from './leads.ts';
import { chatwootReady, getSettings, setSettings, webhookSecret } from './settings.ts';
import {
  addInvestment, clearWebhookLogs, deleteInvestment, investmentProblem, listInboxes, listInvestments, listWebhookLogs,
  updateInbox, updateInvestment, getInbox, inboxLabel,
} from './store.ts';
import { rescheduleAutoSync } from './scheduler.ts';
import { CHANNELS, LEAD_STATUSES, type AnalyticsFilter, type Channel, type ChatwootSettings, type LeadStatus, type Period, type Role } from '../shared/types.ts';

export const api = Router();

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v) || undefined);
const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });
const PERIODS: Period[] = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'this_year', 'all', 'custom'];

function chatwootFail(res: Response, err: unknown) {
  if (err instanceof ChatwootError) return fail(res, 502, err.message);
  console.error(err);
  return fail(res, 500, 'Erro inesperado no servidor.');
}

// ---------- Autenticação ----------

api.get('/auth/me', (req, res) => {
  res.json({ user: req.user ?? null, needs_setup: userCount() === 0 });
});

api.post('/auth/setup', (req, res) => {
  const name = str(req.body?.name)?.trim();
  const email = str(req.body?.email)?.trim();
  const password = req.body?.password;
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Informe nome e e-mail válidos.');
  const problem = passwordProblem(password);
  if (problem) return fail(res, 400, problem);
  const user = createFirstAdmin({ name, email, password });
  if (!user) return fail(res, 409, 'O sistema já foi configurado. Faça login.');
  startSession(res, user.id);
  res.json({ user });
});

api.post('/auth/login', (req, res) => {
  const email = str(req.body?.email)?.trim().toLowerCase() ?? '';
  const password = str(req.body?.password) ?? '';
  const key = `${req.ip}|${email}`;
  if (loginBlocked(key)) return fail(res, 429, 'Muitas tentativas. Aguarde 15 minutos.');
  const row = email ? findUserByEmail(email) : undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    registerLoginFailure(key);
    return fail(res, 401, 'E-mail ou senha incorretos.');
  }
  if (!row.active) return fail(res, 403, 'Seu acesso está desativado. Fale com um administrador.');
  clearLoginFailures(key);
  startSession(res, row.id);
  res.json({ user: { id: row.id, name: row.name, email: row.email, role: row.role, active: true } });
});

api.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

api.post('/auth/password', requireRole(), (req, res) => {
  const row = findUserByEmail(req.user!.email)!;
  if (!verifyPassword(str(req.body?.current) ?? '', row.password_hash)) return fail(res, 400, 'Senha atual incorreta.');
  const problem = passwordProblem(req.body?.next);
  if (problem) return fail(res, 400, problem);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.next), row.id);
  revokeUserSessions(row.id);
  startSession(res, row.id);
  res.json({ ok: true });
});

// ---------- Webhook do Chatwoot ----------

api.post('/webhooks/chatwoot/:secret', (req, res) => {
  const expected = Buffer.from(webhookSecret());
  const got = Buffer.from(String(req.params.secret));
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return fail(res, 404, 'Não encontrado.');
  try {
    res.json(handleWebhook(req.body ?? {}));
  } catch (err) {
    console.error('[webhook]', err);
    res.status(200).json({ status: 'error' }); // 200 para o Chatwoot não reenviar em loop
  }
});

// A partir daqui, tudo exige sessão.
api.use(requireRole());

// ---------- Painel ----------

function parseFilter(q: Record<string, unknown>): AnalyticsFilter {
  const period = PERIODS.includes(q.period as Period) ? (q.period as Period) : 'last_30_days';
  return {
    period,
    start: str(q.start),
    end: str(q.end),
    inbox_id: num(q.inbox_id),
    channel: CHANNELS.includes(q.channel as Channel) ? (q.channel as Channel) : undefined,
  };
}

api.get('/analytics', (req, res) => {
  res.json(computeAnalytics(parseFilter(req.query)));
});

api.get('/reports', requireRole('manager'), (req, res) => {
  res.json(computeReport(parseFilter(req.query)));
});

// ---------- Backup ----------

api.get('/backup', requireRole('admin'), (_req, res) => {
  const stamp = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chatanalytics-backup-${stamp}.json"`);
  res.send(JSON.stringify(exportBackup()));
});

api.post('/backup/import', requireRole('admin'), (req, res) => {
  const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';
  try {
    const result = importBackup(req.body?.data, mode);
    if (chatwootReady()) rescheduleAutoSync();
    res.json(result);
  } catch (err) {
    fail(res, 400, (err as Error).message);
  }
});

// ---------- Leads ----------

function parseLeadQuery(q: Record<string, unknown>): LeadQuery {
  return {
    ...parseFilter(q),
    period: PERIODS.includes(q.period as Period) ? (q.period as Period) : 'all',
    status: LEAD_STATUSES.includes(q.status as LeadStatus) ? (q.status as LeadStatus) : undefined,
    vendeu: q.vendeu === 'sim' ? true : q.vendeu === 'nao' ? false : undefined,
    conflict: q.conflict === '1',
    search: str(q.search),
    page: num(q.page),
    page_size: num(q.page_size),
    sort: str(q.sort) as LeadQuery['sort'],
    dir: q.dir === 'asc' ? 'asc' : 'desc',
  };
}

api.get('/leads', (req, res) => res.json(listLeads(parseLeadQuery(req.query))));
api.get('/leads/facets', (_req, res) => res.json(leadFacets()));

api.get('/leads/export.csv', requireRole('manager'), (req, res) => {
  const leads = allLeadsFor(parseLeadQuery(req.query));
  const cols = [
    ['Nome', 'contact_name'], ['Telefone', 'contact_phone'], ['E-mail', 'contact_email'], ['Entrada', 'entry_date'],
    ['Canal', 'channel'], ['Caixa', 'inbox_name'], ['Status', 'status'], ['CPF', 'cpf'], ['Nascimento', 'birth_date'],
    ['CNH', 'cnh'], ['Vendedor', 'vendedor'], ['Loja', 'loja'], ['Vendeu', 'vendeu'], ['Valor', 'valor_venda'],
    ['Data da venda', 'sale_date'], ['Motivo reprovação', 'motivo_reprovacao'], ['Observação', 'observacao'],
    ['Conversa', 'chatwoot_url'],
  ] as const;
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // evita injeção de fórmulas no Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [cols.map((c) => esc(c[0])).join(';')];
  for (const l of leads) lines.push(cols.map(([, k]) => esc(l[k])).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

api.get('/leads/:id', (req, res) => {
  const lead = getLead(req.params.id);
  return lead ? res.json(lead) : fail(res, 404, 'Lead não encontrado.');
});

api.post('/leads', (req, res) => {
  const name = str(req.body?.contact_name)?.trim();
  const phone = str(req.body?.contact_phone)?.trim();
  if (!name || !phone) return fail(res, 400, 'Informe nome e telefone.');
  const inbox = num(req.body?.inbox_id) ? getInbox(Number(req.body.inbox_id)) : null;
  const channel = CHANNELS.includes(req.body?.channel) ? (req.body.channel as Channel) : 'Outros';
  res.status(201).json(
    createManualLead({
      account_id: getSettings().account_id,
      contact_name: name,
      contact_phone: phone,
      contact_email: str(req.body?.contact_email),
      channel,
      inbox_id: inbox?.id ?? null,
      inbox_name: inboxLabel(inbox),
    }),
  );
});

const PATCHABLE = [
  'contact_name', 'contact_phone', 'contact_email', 'cpf', 'birth_date', 'cnh', 'status', 'vendedor', 'loja', 'vendeu',
  'valor_venda', 'observacao', 'motivo_reprovacao',
] as const;

api.patch('/leads/:id', async (req, res) => {
  const patch: Record<string, unknown> = {};
  for (const k of PATCHABLE) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  const problem = validatePatch(patch);
  if (problem) return fail(res, 400, problem);
  const before = getLead(req.params.id);
  if (!before) return fail(res, 404, 'Lead não encontrado.');
  const lead = updateLead(req.params.id, patch as LeadPatch)!;

  let warning: string | undefined;
  if ((lead.status === 'APROVADO' || lead.status === 'REPROVADO') && lead.status !== before.status) {
    const { add, remove } = labelsForStatus(lead.status);
    try {
      await applyLabels(lead, add, remove);
    } catch (err) {
      warning = `Lead salvo, mas não foi possível atualizar as etiquetas no Chatwoot: ${(err as Error).message}`;
    }
  }
  res.json({ lead, warning });
});

api.post('/leads/:id/rescan', async (req, res) => {
  try {
    const result = await rescanLead(req.params.id);
    if (!result) return fail(res, 404, 'Lead não encontrado.');
    res.json(result);
  } catch (err) {
    chatwootFail(res, err);
  }
});

api.delete('/leads/:id', requireRole('manager'), (req, res) => {
  return deleteLead(String(req.params.id)) ? res.json({ ok: true }) : fail(res, 404, 'Lead não encontrado.');
});

// ---------- Caixas de entrada ----------

api.get('/inboxes', (_req, res) => res.json(listInboxes()));

api.patch('/inboxes/:id', requireRole('manager'), (req, res) => {
  const ib = updateInbox(Number(req.params.id), {
    enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined,
    custom_name: req.body?.custom_name === undefined ? undefined : str(req.body.custom_name) ?? null,
  });
  return ib ? res.json(ib) : fail(res, 404, 'Caixa não encontrada.');
});

api.post('/inboxes/refresh', requireRole('manager'), async (_req, res) => {
  try {
    await refreshInboxes();
    res.json(listInboxes());
  } catch (err) {
    chatwootFail(res, err);
  }
});

// ---------- Investimentos ----------

api.get('/investments', requireRole('manager'), (_req, res) => res.json(listInvestments()));

api.post('/investments', requireRole('manager'), (req, res) => {
  const problem = investmentProblem(req.body ?? {});
  if (problem) return fail(res, 400, problem);
  res.status(201).json(addInvestment(req.body));
});

api.put('/investments/:id', requireRole('manager'), (req, res) => {
  const problem = investmentProblem(req.body ?? {});
  if (problem) return fail(res, 400, problem);
  const inv = updateInvestment(Number(req.params.id), req.body);
  return inv ? res.json(inv) : fail(res, 404, 'Investimento não encontrado.');
});

api.delete('/investments/:id', requireRole('manager'), (req, res) => {
  return deleteInvestment(Number(req.params.id)) ? res.json({ ok: true }) : fail(res, 404, 'Investimento não encontrado.');
});

// ---------- Integração ----------

function publicSettings(req: Request): ChatwootSettings {
  const s = getSettings();
  const origin = `${req.protocol}://${req.get('host')}`;
  return {
    chatwoot_url: s.chatwoot_url,
    account_id: s.account_id,
    has_token: Boolean(s.api_token),
    token_hint: s.api_token ? `••••${s.api_token.slice(-4)}` : '',
    auto_sync_enabled: s.auto_sync_enabled,
    auto_sync_minutes: s.auto_sync_minutes,
    labels_on_approve: s.labels_on_approve,
    labels_on_reject: s.labels_on_reject,
    webhook_url: `${origin}/api/webhooks/chatwoot/${webhookSecret()}`,
    last_sync_at: s.last_sync_at,
    last_sync_status: isSyncing() ? 'syncing' : s.last_sync_status,
    last_sync_message: s.last_sync_message,
  };
}

api.get('/settings', (req, res) => res.json(publicSettings(req)));

api.put('/settings', requireRole('admin'), async (req, res) => {
  const b = req.body ?? {};
  const next = {
    chatwoot_url: str(b.chatwoot_url)?.trim().replace(/\/+$/, ''),
    account_id: b.account_id !== undefined ? String(b.account_id).trim() : undefined,
    api_token: str(b.api_token)?.trim() || undefined,
    auto_sync_enabled: typeof b.auto_sync_enabled === 'boolean' ? b.auto_sync_enabled : undefined,
    auto_sync_minutes:
      b.auto_sync_minutes !== undefined ? Math.min(1440, Math.max(2, Math.round(Number(b.auto_sync_minutes) || 10))) : undefined,
    labels_on_approve: str(b.labels_on_approve),
    labels_on_reject: str(b.labels_on_reject),
  };
  if (next.chatwoot_url && !/^https?:\/\//.test(next.chatwoot_url)) return fail(res, 400, 'A URL precisa começar com http(s)://');

  const connectionChanged = next.chatwoot_url !== undefined || next.account_id !== undefined || next.api_token !== undefined;
  if (connectionChanged) {
    const candidate = { ...getSettings(), ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) };
    if (candidate.chatwoot_url && candidate.account_id && candidate.api_token) {
      try {
        await testConnection(candidate);
      } catch (err) {
        return chatwootFail(res, err);
      }
    }
  }
  setSettings(next);
  if (connectionChanged && chatwootReady()) refreshInboxes().catch(() => {});
  rescheduleAutoSync();
  res.json(publicSettings(req));
});

api.post('/settings/test', requireRole('admin'), async (req, res) => {
  const s = getSettings();
  const candidate = {
    chatwoot_url: str(req.body?.chatwoot_url)?.trim() || s.chatwoot_url,
    account_id: req.body?.account_id ? String(req.body.account_id) : s.account_id,
    api_token: str(req.body?.api_token)?.trim() || s.api_token,
  };
  try {
    const inboxes = await testConnection(candidate);
    res.json({ ok: true, inboxes: inboxes.length });
  } catch (err) {
    chatwootFail(res, err);
  }
});

api.post('/sync', requireRole('manager'), async (req, res) => {
  try {
    res.json(await syncConversations({ full: req.body?.full === true }));
  } catch (err) {
    chatwootFail(res, err);
  }
});

api.get('/webhook-logs', requireRole('manager'), (_req, res) => res.json(listWebhookLogs(200)));
api.delete('/webhook-logs', requireRole('admin'), (_req, res) => {
  clearWebhookLogs();
  res.json({ ok: true });
});

// ---------- Usuários ----------

const ROLES: Role[] = ['admin', 'manager', 'operator'];

api.get('/users', requireRole('admin'), (_req, res) => res.json(listUsers()));

api.post('/users', requireRole('admin'), (req, res) => {
  const name = str(req.body?.name)?.trim();
  const email = str(req.body?.email)?.trim();
  const role = req.body?.role as Role;
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Informe nome e e-mail válidos.');
  if (!ROLES.includes(role)) return fail(res, 400, 'Perfil inválido.');
  const problem = passwordProblem(req.body?.password);
  if (problem) return fail(res, 400, problem);
  if (findUserByEmail(email)) return fail(res, 409, 'Já existe um usuário com este e-mail.');
  res.status(201).json(createUser({ name, email, password: req.body.password, role }));
});

api.patch('/users/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as { role: Role; active: number } | undefined;
  if (!row) return fail(res, 404, 'Usuário não encontrado.');
  const role = req.body?.role as Role | undefined;
  const active = typeof req.body?.active === 'boolean' ? req.body.active : undefined;
  if (role && !ROLES.includes(role)) return fail(res, 400, 'Perfil inválido.');
  const losesAdmin = row.role === 'admin' && row.active && ((role && role !== 'admin') || active === false);
  if (losesAdmin && activeAdminCount(id) === 0) return fail(res, 400, 'É preciso manter pelo menos um administrador ativo.');
  if (req.body?.password !== undefined) {
    const problem = passwordProblem(req.body.password);
    if (problem) return fail(res, 400, problem);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), id);
    revokeUserSessions(id);
  }
  if (str(req.body?.name)?.trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(req.body.name.trim(), id);
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (!active) revokeUserSessions(id);
  }
  res.json(listUsers().find((u) => u.id === id));
});
