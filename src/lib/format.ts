// Formatação pt-BR (moeda, números, datas relativas) no fuso de Belém.

const TZ = 'America/Belem';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlShort = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('pt-BR');

export const money = (v: number) => brl.format(v || 0);
export const moneyShort = (v: number) => (Math.abs(v) >= 10_000 ? brlShort.format(v) : brl.format(v || 0));
export const number = (v: number) => int.format(Math.round(v || 0));
export const percent = (v: number, digits = 1) => `${(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
export const ratio = (v: number) => `${(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`;

export function dateShort(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }).replace('.', '');
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "agora", "há 5 min", "há 3 h", "ontem", "12 de out". */
export function relative(iso: string | null | undefined) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short' }).replace('.', '');
}

/** Rótulo de eixo para dias (YYYY-MM-DD) ou meses. */
export function axisLabel(key: string, bucket: 'day' | 'month') {
  const d = new Date(`${key}T12:00:00Z`);
  return bucket === 'month'
    ? d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')
    : `${d.getUTCDate()} ${d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}`;
}

export function monthLabel(ym: string) {
  const d = new Date(`${ym}-15T12:00:00Z`);
  return `${d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function phone(raw: string) {
  const d = raw.replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw;
}
