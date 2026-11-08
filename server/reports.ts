// Relatório do período: indicadores + vendedores, lojas, motivos de reprovação e qualidade dos dados.

import { db } from './db.ts';
import { computeAnalytics } from './analytics.ts';
import { rangeForPeriod, rangeToIso } from '../shared/dates.ts';
import type { AnalyticsFilter, Report, ReportGroup } from '../shared/types.ts';

export function computeReport(f: AnalyticsFilter): Report {
  const analytics = computeAnalytics(f);
  const where = ['(inbox_id IS NULL OR inbox_id NOT IN (SELECT id FROM inboxes WHERE enabled = 0))'];
  const params: (string | number)[] = [];
  const range = rangeForPeriod(f.period, { start: f.start, end: f.end });
  if (range) {
    const { from, to } = rangeToIso(range);
    where.push('entry_date >= ? AND entry_date < ?');
    params.push(from, to);
  }
  if (f.inbox_id) (where.push('inbox_id = ?'), params.push(f.inbox_id));
  if (f.channel) (where.push('channel = ?'), params.push(f.channel));
  const sql = where.join(' AND ');

  const group = (col: string, empty: string): ReportGroup[] =>
    (db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(${col}), ''), ?) AS name, COUNT(*) AS leads,
                SUM(vendeu) AS sales, COALESCE(SUM(CASE WHEN vendeu = 1 THEN valor_venda END), 0) AS revenue
         FROM leads WHERE ${sql} GROUP BY 1 ORDER BY revenue DESC, leads DESC`,
      )
      .all(empty, ...params) as unknown as ReportGroup[]).map((g) => ({ ...g, sales: Number(g.sales) || 0 }));

  const rejections = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(motivo_reprovacao), ''), 'Não informado') AS reason, COUNT(*) AS count
       FROM leads WHERE ${sql} AND status = 'REPROVADO' GROUP BY 1 ORDER BY count DESC`,
    )
    .all(...params) as { reason: string; count: number }[];

  const q = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(cpf IS NOT NULL AND cpf_valid = 1) AS cpf, SUM(birth_date IS NOT NULL) AS birth,
              SUM(cnh IS NOT NULL) AS cnh, SUM(cpf_conflict IS NOT NULL) AS conflicts
       FROM leads WHERE ${sql}`,
    )
    .get(...params) as Record<string, number | null>;

  return {
    analytics,
    sellers: group('vendedor', 'Sem vendedor'),
    stores: group('loja', 'Sem loja'),
    rejections,
    quality: {
      total: Number(q.total) || 0,
      cpf: Number(q.cpf) || 0,
      birth: Number(q.birth) || 0,
      cnh: Number(q.cnh) || 0,
      conflicts: Number(q.conflicts) || 0,
    },
  };
}
