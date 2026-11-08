// Datas no fuso de Belém (UTC−3 fixo, sem horário de verão).

import type { Period } from './types.ts';

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Dia local (YYYY-MM-DD) de um instante. */
export function dayKey(input: Date | string | number = Date.now()): string {
  const t = new Date(input).getTime();
  return new Date(t - OFFSET_MS).toISOString().slice(0, 10);
}

/** Instante UTC em que começa o dia local informado. */
export function dayStart(key: string): Date {
  return new Date(Date.parse(`${key}T00:00:00Z`) + OFFSET_MS);
}

export function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(startKey: string, endKey: string): number {
  return Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / DAY_MS) + 1;
}

export interface DayRange {
  start: string; // dia inicial inclusivo
  end: string; // dia final inclusivo
}

/** Intervalo em dias locais. `null` para "tudo". */
export function rangeForPeriod(period: Period, custom?: { start?: string; end?: string }, now = Date.now()): DayRange | null {
  const today = dayKey(now);
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  const monthEnd = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);

  switch (period) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { start: d, end: d };
    }
    case 'last_7_days':
      return { start: addDays(today, -6), end: today };
    case 'last_30_days':
      return { start: addDays(today, -29), end: today };
    case 'this_month':
      return { start: monthStart(y, m), end: today };
    case 'last_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { start: monthStart(py, pm), end: monthEnd(py, pm) };
    }
    case 'this_year':
      return { start: `${y}-01-01`, end: today };
    case 'custom':
      if (custom?.start && custom?.end && custom.start <= custom.end) return { start: custom.start, end: custom.end };
      return { start: monthStart(y, m), end: today };
    case 'all':
    default:
      return null;
  }
}

/** Período imediatamente anterior, com o mesmo número de dias. */
export function previousRange(r: DayRange): DayRange {
  const len = daysBetween(r.start, r.end);
  return { start: addDays(r.start, -len), end: addDays(r.start, -1) };
}

/** Limites ISO [início, fim) para consultas. */
export function rangeToIso(r: DayRange): { from: string; to: string } {
  return { from: dayStart(r.start).toISOString(), to: dayStart(addDays(r.end, 1)).toISOString() };
}
