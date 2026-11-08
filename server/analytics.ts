// Indicadores do painel: volume, vendas, conversão, investimento (CPL, CAC, ROAS), canais e meses.

import { db } from './db.ts';
import { addDays, dayKey, daysBetween, previousRange, rangeForPeriod, rangeToIso, type DayRange } from '../shared/dates.ts';
import { investedBetween, investedByMonth, listInboxes, inboxLabel } from './store.ts';
import type { Analytics, AnalyticsFilter, Channel, ChannelRow, Kpi, LeadStatus, MonthRow, SeriesPoint } from '../shared/types.ts';

interface LeadLite {
  entry_date: string;
  sale_date: string | null;
  vendeu: number;
  valor_venda: number;
  status: LeadStatus;
  channel: Channel;
  inbox_id: number | null;
  inbox_name: string | null;
}

function scope(f: AnalyticsFilter): { sql: string; params: (string | number)[] } {
  const where = ['(inbox_id IS NULL OR inbox_id NOT IN (SELECT id FROM inboxes WHERE enabled = 0))'];
  const params: (string | number)[] = [];
  if (f.inbox_id) (where.push('inbox_id = ?'), params.push(f.inbox_id));
  if (f.channel) (where.push('channel = ?'), params.push(f.channel));
  return { sql: where.join(' AND '), params };
}

function leadsEntered(f: AnalyticsFilter, r: DayRange): LeadLite[] {
  const { sql, params } = scope(f);
  const { from, to } = rangeToIso(r);
  return db
    .prepare(
      `SELECT entry_date, sale_date, vendeu, valor_venda, status, channel, inbox_id, inbox_name
       FROM leads WHERE ${sql} AND entry_date >= ? AND entry_date < ?`,
    )
    .all(...params, from, to) as unknown as LeadLite[];
}

function salesClosed(f: AnalyticsFilter, r: DayRange): LeadLite[] {
  const { sql, params } = scope(f);
  const { from, to } = rangeToIso(r);
  return db
    .prepare(
      `SELECT entry_date, sale_date, vendeu, valor_venda, status, channel, inbox_id, inbox_name
       FROM leads WHERE ${sql} AND vendeu = 1 AND sale_date >= ? AND sale_date < ?`,
    )
    .all(...params, from, to) as unknown as LeadLite[];
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
const kpi = (value: number, previous: number): Kpi => ({
  value,
  previous,
  change: previous > 0 ? ((value - previous) / previous) * 100 : value > 0 ? null : 0,
});

interface Totals {
  leads: number;
  sales: number;
  revenue: number;
  conversion: number;
  approval: number;
  invested: number;
}

function totals(f: AnalyticsFilter, r: DayRange): Totals & { entered: LeadLite[]; closed: LeadLite[] } {
  const entered = leadsEntered(f, r);
  const closed = salesClosed(f, r);
  const approved = entered.filter((l) => l.status === 'APROVADO').length;
  const rejected = entered.filter((l) => l.status === 'REPROVADO').length;
  return {
    entered,
    closed,
    leads: entered.length,
    sales: closed.length,
    revenue: closed.reduce((s, l) => s + l.valor_venda, 0),
    conversion: pct(entered.filter((l) => l.vendeu).length, entered.length),
    approval: pct(approved, approved + rejected),
    invested: investedBetween(r.start, r.end),
  };
}

function firstLeadDay(): string {
  const r = db.prepare('SELECT MIN(entry_date) AS d FROM leads').get() as { d: string | null };
  return r.d ? dayKey(r.d) : addDays(dayKey(), -29);
}

export function computeAnalytics(f: AnalyticsFilter): Analytics {
  const today = dayKey();
  const range = rangeForPeriod(f.period, { start: f.start, end: f.end }) ?? { start: firstLeadDay(), end: today };
  const cur = totals(f, range);
  const prev = f.period === 'all' ? null : totals(f, previousRange(range));

  // Série: diária até ~3 meses, mensal acima disso.
  const days = daysBetween(range.start, range.end);
  const monthly = days > 92;
  const bucketOf = (iso: string) => (monthly ? `${dayKey(iso).slice(0, 7)}-01` : dayKey(iso));
  const buckets = new Map<string, SeriesPoint>();
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const key = monthly ? `${d.slice(0, 7)}-01` : d;
    if (!buckets.has(key)) buckets.set(key, { date: key, leads: 0, sales: 0 });
  }
  for (const l of cur.entered) {
    const b = buckets.get(bucketOf(l.entry_date));
    if (b) b.leads++;
  }
  for (const l of cur.closed) {
    const b = l.sale_date ? buckets.get(bucketOf(l.sale_date)) : undefined;
    if (b) b.sales++;
  }

  // Canais: agrupados por caixa de entrada (ou canal, quando não há caixa).
  const inboxes = new Map(listInboxes().map((ib) => [ib.id, ib]));
  const byKey = new Map<string, ChannelRow>();
  for (const l of cur.entered) {
    const key = l.inbox_id ? `inbox:${l.inbox_id}` : `channel:${l.channel}`;
    let row = byKey.get(key);
    if (!row) {
      const name = (l.inbox_id && inboxLabel(inboxes.get(l.inbox_id))) || l.inbox_name || l.channel;
      row = { key, name, channel: l.channel, leads: 0, sales: 0, revenue: 0, conversion: 0, share: 0 };
      byKey.set(key, row);
    }
    row.leads++;
    if (l.vendeu) {
      row.sales++;
      row.revenue += l.valor_venda;
    }
  }
  const channels = [...byKey.values()]
    .map((r) => ({ ...r, conversion: pct(r.sales, r.leads), share: pct(r.leads, cur.leads) }))
    .sort((a, b) => b.leads - a.leads);

  // Últimos 12 meses.
  const months: MonthRow[] = [];
  const invested = investedByMonth();
  const { sql, params } = scope(f);
  const monthLeads = new Map(
    (db
      .prepare(`SELECT substr(datetime(entry_date,'-3 hours'),1,7) AS m, COUNT(*) AS n FROM leads WHERE ${sql} GROUP BY m`)
      .all(...params) as { m: string; n: number }[]).map((r) => [r.m, r.n]),
  );
  const monthSales = new Map(
    (db
      .prepare(
        `SELECT substr(datetime(sale_date,'-3 hours'),1,7) AS m, COUNT(*) AS n, SUM(valor_venda) AS v
         FROM leads WHERE ${sql} AND vendeu = 1 AND sale_date IS NOT NULL GROUP BY m`,
      )
      .all(...params) as { m: string; n: number; v: number }[]).map((r) => [r.m, r]),
  );
  const [ty, tm] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const m = d.toISOString().slice(0, 7);
    const leads = monthLeads.get(m) ?? 0;
    const s = monthSales.get(m);
    const inv = invested.get(m) ?? 0;
    const revenue = s?.v ?? 0;
    months.push({
      month: m,
      leads,
      sales: s?.n ?? 0,
      revenue,
      invested: inv,
      cpl: leads ? inv / leads : 0,
      cac: s?.n ? inv / s.n : 0,
      roas: inv ? revenue / inv : 0,
    });
  }

  const status = { NOVO: 0, EM_ANALISE: 0, PENDENTE: 0, APROVADO: 0, REPROVADO: 0 } as Record<LeadStatus, number>;
  for (const l of cur.entered) status[l.status] = (status[l.status] ?? 0) + 1;

  const todayTotals = range.start === today && range.end === today ? cur : totals(f, { start: today, end: today });

  return {
    range: { start: range.start, end: range.end, days },
    leads: kpi(cur.leads, prev?.leads ?? 0),
    sales: kpi(cur.sales, prev?.sales ?? 0),
    revenue: kpi(cur.revenue, prev?.revenue ?? 0),
    conversion: kpi(cur.conversion, prev?.conversion ?? 0),
    approval: kpi(cur.approval, prev?.approval ?? 0),
    invested: kpi(cur.invested, prev?.invested ?? 0),
    cpl: cur.leads ? cur.invested / cur.leads : 0,
    cac: cur.sales ? cur.invested / cur.sales : 0,
    roas: cur.invested ? cur.revenue / cur.invested : 0,
    ticket: cur.sales ? cur.revenue / cur.sales : 0,
    status,
    series: [...buckets.values()],
    series_bucket: monthly ? 'month' : 'day',
    channels,
    months,
    today: { leads: todayTotals.leads, sales: todayTotals.sales },
  };
}
