// Anúncios (criativos) identificados nas conversas e o desempenho de cada um.

import { db, nowIso } from './db.ts';
import { defaultAdLabel, type AdInfo } from '../shared/adParser.ts';
import { rangeForPeriod, rangeToIso } from '../shared/dates.ts';
import type { Ad, Period } from '../shared/types.ts';

type Row = Record<string, unknown>;

const labelOf = (r: Row) =>
  (r.name as string) || defaultAdLabel({ id: r.id as string, description: (r.description as string) ?? null, platform: (r.platform as string) ?? null });

/** Grava/atualiza o anúncio e devolve o rótulo que o lead deve usar como criativo. */
export function upsertAd(ad: AdInfo & { image?: string | null }): string | null {
  if (!ad.id) return null;
  const now = nowIso();
  db.prepare(
    `INSERT INTO ads (id, platform, title, description, link, image_url, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       platform = COALESCE(excluded.platform, platform),
       title = COALESCE(excluded.title, title),
       description = COALESCE(excluded.description, description),
       link = COALESCE(excluded.link, link),
       image_url = COALESCE(excluded.image_url, image_url),
       last_seen = excluded.last_seen`,
  ).run(ad.id, ad.platform, ad.title, ad.description, ad.link, ad.image ?? null, now, now);
  return labelOf(db.prepare('SELECT * FROM ads WHERE id = ?').get(ad.id) as Row);
}

export function adLabel(id: string): string | null {
  const r = db.prepare('SELECT * FROM ads WHERE id = ?').get(id) as Row | undefined;
  return r ? labelOf(r) : null;
}

/** Dá um nome amigável ao anúncio e aplica nos leads cujo criativo não foi digitado à mão. */
export function renameAd(id: string, name: string | null): Ad | null {
  const res = db.prepare('UPDATE ads SET name = ? WHERE id = ?').run(name?.trim() || null, id);
  if (!res.changes) return null;
  const label = adLabel(id)!;
  db.prepare(
    `UPDATE leads SET criativo = ?, updated_at = ? WHERE ad_id = ? AND manual_fields NOT LIKE '%"criativo"%'`,
  ).run(label, nowIso(), id);
  return listAds({ period: 'all' }).find((a) => a.id === id) ?? null;
}

export function listAds(f: { period: Period; start?: string; end?: string }): Ad[] {
  const range = rangeForPeriod(f.period, { start: f.start, end: f.end });
  const params: string[] = [];
  let join = 'l.ad_id = a.id';
  if (range) {
    const { from, to } = rangeToIso(range);
    join += ' AND l.entry_date >= ? AND l.entry_date < ?';
    params.push(from, to);
  }
  const rows = db
    .prepare(
      `SELECT a.*, (SELECT MAX(entry_date) FROM leads x WHERE x.ad_id = a.id) AS last_lead, COUNT(l.id) AS leads, COALESCE(SUM(l.vendeu), 0) AS sales,
              COALESCE(SUM(CASE WHEN l.vendeu = 1 THEN l.valor_venda END), 0) AS revenue
       FROM ads a LEFT JOIN leads l ON ${join}
       GROUP BY a.id ORDER BY leads DESC, last_lead DESC`,
    )
    .all(...params) as Row[];
  return rows.map((r) => {
    const leads = Number(r.leads) || 0;
    const sales = Number(r.sales) || 0;
    return {
      id: String(r.id),
      platform: (r.platform as string) ?? null,
      title: (r.title as string) ?? null,
      description: (r.description as string) ?? null,
      link: (r.link as string) ?? null,
      image_url: (r.image_url as string) ?? null,
      name: (r.name as string) ?? null,
      label: labelOf(r),
      first_seen: String(r.first_seen),
      last_seen: String(r.last_lead ?? r.last_seen),
      leads,
      sales,
      revenue: Number(r.revenue) || 0,
      conversion: leads ? (sales / leads) * 100 : 0,
    };
  });
}

/** Leads do período sem anúncio identificado (orgânicos ou anteriores à captura). */
export function leadsWithoutAd(f: { period: Period; start?: string; end?: string }): { leads: number; sales: number; revenue: number } {
  const range = rangeForPeriod(f.period, { start: f.start, end: f.end });
  const where = ['ad_id IS NULL', '(inbox_id IS NULL OR inbox_id NOT IN (SELECT id FROM inboxes WHERE enabled = 0))'];
  const params: string[] = [];
  if (range) {
    const { from, to } = rangeToIso(range);
    where.push('entry_date >= ? AND entry_date < ?');
    params.push(from, to);
  }
  const r = db
    .prepare(
      `SELECT COUNT(*) AS leads, COALESCE(SUM(vendeu),0) AS sales,
              COALESCE(SUM(CASE WHEN vendeu = 1 THEN valor_venda END),0) AS revenue
       FROM leads WHERE ${where.join(' AND ')}`,
    )
    .get(...params) as Row;
  return { leads: Number(r.leads) || 0, sales: Number(r.sales) || 0, revenue: Number(r.revenue) || 0 };
}
