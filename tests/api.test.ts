import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env.DATABASE_PATH = ':memory:';
const express = (await import('express')).default;
const { sessionMiddleware } = await import('../server/auth.ts');
const { api } = await import('../server/routes.ts');
const { webhookSecret } = await import('../server/settings.ts');
const { dayKey } = await import('../shared/dates.ts');

let server: Server;
let base = '';
let adminCookie = '';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', sessionMiddleware, api);
  await new Promise<void>((r) => (server = app.listen(0, () => r())));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown, cookie = adminCookie) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data: data as any, cookie: setCookie?.split(';')[0] ?? '' };
}

test('primeiro acesso cria o administrador e bloqueia uma segunda configuração', async () => {
  assert.equal((await call('GET', '/auth/me', undefined, '')).data.needs_setup, true);
  const r = await call('POST', '/auth/setup', { name: 'Admin', email: 'admin@teste.com', password: 'senha-forte-1' }, '');
  assert.equal(r.status, 200);
  adminCookie = r.cookie;
  const again = await call('POST', '/auth/setup', { name: 'X', email: 'x@teste.com', password: 'senha-forte-1' }, '');
  assert.equal(again.status, 409);
});

test('rotas protegidas exigem sessão', async () => {
  assert.equal((await call('GET', '/leads', undefined, '')).status, 401);
  assert.equal((await call('GET', '/analytics', undefined, '')).status, 401);
  assert.equal((await call('POST', '/webhooks/chatwoot/segredo-errado', {}, '')).status, 404);
});

test('login com senha errada falha; correta funciona', async () => {
  assert.equal((await call('POST', '/auth/login', { email: 'admin@teste.com', password: 'errada123' }, '')).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'ADMIN@teste.com', password: 'senha-forte-1' }, '')).status, 200);
});

test('webhook cria lead e extrai CPF da mensagem do cliente', async () => {
  const payload = {
    event: 'message_created',
    id: 9001,
    content: 'Olá, meu CPF é 529.982.247-25 e tenho CNH',
    message_type: 'incoming',
    private: false,
    created_at: new Date().toISOString(),
    sender: { id: 77, name: 'Maria Teste', phone_number: '+5591988887777', type: 'contact' },
    conversation: { id: 501, inbox_id: 3, labels: ['trafego_pago'], created_at: Math.floor(Date.now() / 1000) },
    account: { id: 5 },
  };
  const r = await call('POST', `/webhooks/chatwoot/${webhookSecret()}`, payload, '');
  assert.equal(r.data.status, 'processed');
  const dup = await call('POST', `/webhooks/chatwoot/${webhookSecret()}`, payload, '');
  assert.equal(dup.data.status, 'ignored');

  const lead = (await call('GET', '/leads/5_77')).data;
  assert.equal(lead.contact_name, 'Maria Teste');
  assert.equal(lead.cpf, '529.982.247-25');
  assert.equal(lead.cnh, 'SIM');
  assert.deepEqual(lead.tags, ['trafego_pago']);
});

test('aprovar registra venda e aparece nos indicadores', async () => {
  const r = await call('PATCH', '/leads/5_77', { status: 'APROVADO', valor_venda: 1500 });
  assert.equal(r.status, 200);
  assert.equal(r.data.lead.vendeu, true);
  assert.ok(r.data.lead.sale_date);
  await call('POST', '/investments', { date: dayKey(), amount: 300, channel: 'Meta Ads' });
  const a = (await call('GET', '/analytics?period=today')).data;
  assert.equal(a.leads.value, 1);
  assert.equal(a.sales.value, 1);
  assert.equal(a.revenue.value, 1500);
  assert.equal(a.cpl, 300);
  assert.equal(a.roas, 5);
});

test('edição manual protege o campo contra o webhook', async () => {
  await call('PATCH', '/leads/5_77', { cpf: '111.444.777-35' });
  await call('POST', `/webhooks/chatwoot/${webhookSecret()}`, {
    event: 'message_created', id: 9002, content: 'cpf 529.982.247-25', message_type: 'incoming',
    created_at: new Date().toISOString(), sender: { id: 77, name: 'Maria Teste', type: 'contact' },
    conversation: { id: 501, inbox_id: 3 }, account: { id: 5 },
  }, '');
  const lead = (await call('GET', '/leads/5_77')).data;
  assert.equal(lead.cpf, '111.444.777-35');
  assert.equal(lead.field_origins.cpf, 'MANUAL');
});

test('filtro de CPF separa leads com e sem CPF', async () => {
  const extra = (await call('POST', '/leads', { contact_name: 'Sem Documento', contact_phone: '+5591900001111' })).data;
  const com = (await call('GET', '/leads?cpf=com')).data;
  const sem = (await call('GET', '/leads?cpf=sem')).data;
  assert.ok(com.items.length >= 1 && com.items.every((l: any) => l.cpf && l.cpf_valid));
  assert.ok(sem.items.some((l: any) => l.contact_name === 'Sem Documento'));
  assert.ok(sem.items.every((l: any) => !l.cpf || !l.cpf_valid));
  assert.equal(com.total + sem.total, (await call('GET', '/leads')).data.total);
  await call('DELETE', `/leads/${extra.id}`);
});

test('veículo de interesse e criativo são salvos e aparecem no relatório', async () => {
  const r = await call('PATCH', '/leads/5_77', { veiculo: 'Onix 2022', criativo: 'Reels Onix Black Friday' });
  assert.equal(r.data.lead.veiculo, 'Onix 2022');
  assert.equal(r.data.lead.criativo, 'Reels Onix Black Friday');
  const rep = (await call('GET', '/reports?period=today')).data;
  assert.equal(rep.creatives[0].name, 'Reels Onix Black Friday');
  assert.equal(rep.creatives[0].sales, 1);
  assert.equal(rep.vehicles[0].name, 'Onix 2022');
  const busca = (await call('GET', '/leads?search=onix')).data;
  assert.equal(busca.items[0].id, '5_77');
  const facets = (await call('GET', '/leads/facets')).data;
  assert.deepEqual(facets.criativos, ['Reels Onix Black Friday']);
});

test('operador não acessa usuários nem investimentos', async () => {
  await call('POST', '/users', { name: 'Op', email: 'op@teste.com', password: 'senha-op-123', role: 'operator' });
  const login = await call('POST', '/auth/login', { email: 'op@teste.com', password: 'senha-op-123' }, '');
  assert.equal((await call('GET', '/users', undefined, login.cookie)).status, 403);
  assert.equal((await call('GET', '/investments', undefined, login.cookie)).status, 403);
  assert.equal((await call('GET', '/leads', undefined, login.cookie)).status, 200);
});

test('não permite remover o último administrador', async () => {
  const me = (await call('GET', '/auth/me')).data.user;
  assert.equal((await call('PATCH', `/users/${me.id}`, { role: 'operator' })).status, 400);
});

test('relatório agrupa vendedores e motivos de reprovação', async () => {
  await call('PATCH', '/leads/5_77', { vendedor: 'Carlos' });
  const r = (await call('GET', '/reports?period=today')).data;
  assert.equal(r.sellers[0].name, 'Carlos');
  assert.equal(r.sellers[0].sales, 1);
  assert.equal(r.quality.total, 1);
  assert.equal(r.quality.cpf, 1);
});

test('backup exporta e importa (substituir) sem perder dados', async () => {
  const backup = (await call('GET', '/backup')).data;
  assert.equal(backup.version, 3);
  assert.equal(backup.leads.length, 1);
  assert.equal(backup.settings.webhook_secret, undefined);
  const r = await call('POST', '/backup/import', { data: backup, mode: 'replace' });
  assert.equal(r.status, 200);
  assert.equal(r.data.leads, 1);
  const lead = (await call('GET', '/leads/5_77')).data;
  assert.equal(lead.valor_venda, 1500);
  assert.equal(lead.field_origins.cpf, 'MANUAL');
});

test('importa dados do ChatAnalytics 2.0', async () => {
  const legacy = {
    config: { chatwoot_url: 'https://conversa.exemplo.com.br/', account_id: '5', inboxes: [{ id: 37, name: 'Edely', channel_type: 'Channel::Api', enabled: true }] },
    leads: {
      '5_900': {
        id: '5_900', account_id: '5', contact_id: 900, conversation_id: 12, contact_name: 'Lead Antigo',
        contact_phone: '+5591900000000', entry_date: '2026-09-10T14:00:00.000Z', last_interaction_at: '2026-09-11T10:00:00.000Z',
        status: 'EM ANÁLISE', vendeu: false, valor_venda: 0, cpf: '52998224725', birth_date: '1990-05-15',
        channel: 'WhatsApp', channel_detail: 'Edely', inbox_id: 37, tags: ['trafego_pago'], field_origins: { cpf: 'IA' },
      },
      '5_901': {
        id: '5_901', account_id: '5', contact_id: 901, conversation_id: 13, contact_name: 'Venda Antiga',
        entry_date: '2026-09-01T12:00:00.000Z', last_interaction_at: '2026-09-02T12:00:00.000Z',
        status: 'APROVADO', vendeu: true, valor_venda: 3200, conversion_date: '2026-09-05T12:00:00.000Z', channel: 'WhatsApp',
      },
    },
    investments: [{ id: 'x', date: '2026-09-01', amount: 900, channel: 'Meta Ads', created_at: '2026-09-01T00:00:00Z' }],
  };
  const r = await call('POST', '/backup/import', { data: legacy, mode: 'merge' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.format, r.data.leads, r.data.investments, r.data.inboxes], ['legacy', 2, 1, 1]);
  const a = (await call('GET', '/leads/5_900')).data;
  assert.equal(a.status, 'EM_ANALISE');
  assert.equal(a.cpf, '529.982.247-25');
  assert.equal(a.birth_date, '15/05/1990');
  assert.equal(a.field_origins.cpf, 'LOCAL');
  const b = (await call('GET', '/leads/5_901')).data;
  assert.equal(b.sale_date, '2026-09-05T12:00:00.000Z');
  assert.equal((await call('GET', '/leads/5_77')).status, 200, 'merge mantém leads existentes');
  const again = await call('POST', '/backup/import', { data: legacy, mode: 'merge' });
  assert.equal(again.data.investments, 0, 'não duplica investimentos');
});

test('backup e importação exigem administrador', async () => {
  const login = await call('POST', '/auth/login', { email: 'op@teste.com', password: 'senha-op-123' }, '');
  assert.equal((await call('GET', '/backup', undefined, login.cookie)).status, 403);
  assert.equal((await call('GET', '/reports', undefined, login.cookie)).status, 403);
});

test('log do webhook guarda só os 5 últimos eventos', async () => {
  for (let i = 0; i < 7; i++) {
    await call('POST', `/webhooks/chatwoot/${webhookSecret()}`, { event: 'conversation_status_changed', id: i }, '');
  }
  const logs = (await call('GET', '/webhook-logs')).data;
  assert.equal(logs.length, 5);
  assert.ok(logs[0].id > logs[4].id, 'mais recente primeiro');
});

test('eventos ao vivo avisam quando chega um lead pelo webhook', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events`, { headers: { Cookie: adminCookie }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  await reader.read(); // "retry:" inicial
  await call('POST', `/webhooks/chatwoot/${webhookSecret()}`, {
    event: 'message_created', id: 777001, content: 'oi, quero informações', message_type: 'incoming',
    created_at: new Date().toISOString(), sender: { id: 4242, name: 'Lead Ao Vivo', type: 'contact' },
    conversation: { id: 9001, inbox_id: 3 }, account: { id: 5 },
  }, '');
  const deadline = Date.now() + 3000;
  while (!text.includes('event: lead') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  ctrl.abort();
  assert.match(text, /event: lead\ndata: \{"id":"5_4242"\}/);
});

test('eventos ao vivo exigem login', async () => {
  assert.equal((await call('GET', '/events', undefined, '')).status, 401);
});
