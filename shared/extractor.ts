// Extração local (sem IA) de CPF, data de nascimento e CNH a partir das mensagens do cliente.
// Regras portadas do ChatAnalytics 2.0, com prioridade MANUAL > LOCAL > vazio.

import { cleanCPF, formatCPF, validateCPF } from './cpf.ts';
import type { ClientMessage, FieldOrigins } from './types.ts';

export function normalizeText(text: string): string {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface CpfMatch {
  clean: string;
  formatted?: string;
  valid: boolean;
}

/** Procura um CPF válido (com ou sem pontuação). Se só houver 11 dígitos inválidos, retorna valid=false. */
export function extractCPF(text: string): CpfMatch | null {
  if (!text) return null;
  const patterns = [
    /(?:^|\D)(\d{3}\.\d{3}\.\d{3}[-.]\d{2})(?:\D|$)/g,
    /(?:^|\D)(\d{11})(?:\D|$)/g,
    /(?:^|\D)(\d{3}\s+\d{3}\s+\d{3}[\s-]+\d{2})(?:\D|$)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const clean = cleanCPF(m[1]);
      if (validateCPF(clean)) return { clean, formatted: formatCPF(clean), valid: true };
    }
  }
  const any = /(?:^|\D)(\d{11})(?:\D|$)/.exec(text);
  return any ? { clean: any[1], valid: false } : null;
}

export function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= max;
}

export function calculateAge(day: number, month: number, year: number, ref = new Date()): number {
  let age = ref.getFullYear() - year;
  const m = ref.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && ref.getDate() < day)) age--;
  return age;
}

const BIRTH_CONTEXT = ['nascimento', 'nasci', 'nasc', 'dn', 'd.n', 'd/n', 'idade', 'aniversario'];

export interface BirthMatch {
  formatted?: string; // DD/MM/AAAA
  age?: number;
  valid: boolean;
  reason?: string;
}

/** Data de nascimento em DD/MM/AAAA (/, - ou .), exigindo contexto ou mensagem curta. Idade 14–100. */
export function extractBirthDate(text: string, ref = new Date()): BirthMatch | null {
  if (!text) return null;
  const normalized = normalizeText(text);
  const hasContext = BIRTH_CONTEXT.some((w) =>
    new RegExp(`(?:^|\\W)${w.replace(/[./]/g, '\\$&')}(?:\\W|$)`).test(normalized),
  );
  const re = /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](19\d{2}|20\d{2})\b/g;

  for (const m of text.matchAll(re)) {
    const [raw, d, mo, y] = m;
    const day = +d, month = +mo, year = +y;
    const idx = m.index ?? 0;
    const around = normalized.slice(Math.max(0, idx - 35), idx + raw.length + 35);
    const nearby = BIRTH_CONTEXT.some((w) => around.includes(w));
    const isolated = normalized.replace(/[^a-z0-9]/g, '').length <= `${day}${month}${year}`.length + 6;
    if (!hasContext && !nearby && !isolated) continue;

    if (!isValidCalendarDate(day, month, year)) {
      return { valid: false, reason: 'Data inexistente no calendário' };
    }
    const age = calculateAge(day, month, year, ref);
    if (age < 14 || age > 100) {
      return { valid: false, age, reason: `Idade ${age} fora do intervalo 14–100` };
    }
    return {
      valid: true,
      age,
      formatted: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
    };
  }
  return null;
}

const CNH_NO = [
  'nao tenho cnh', 'nao possuo cnh', 'nao tenho habilitacao', 'nao possuo habilitacao',
  'nao sou habilitado', 'nao sou habilitada', 'sem habilitacao', 'sem cnh',
  'ainda nao tirei carteira', 'ainda nao tirei cnh', 'ainda nao tenho carteira', 'ainda nao tenho cnh',
  'nao tenho carteira', 'nao tenho carta', 'nao habilitado', 'nao habilitada',
  'sem carteira de motorista', 'nunca tirei cnh', 'nunca tirei habilitacao',
];
const CNH_YES = [
  'tenho cnh', 'possuo habilitacao', 'possuo cnh', 'sou habilitado', 'sou habilitada',
  'tenho carteira', 'tenho carta', 'tenho habilitacao', 'cnh definitiva', 'cnh provisoria',
  'cnh em dia', 'carteira de motorista', 'categoria a', 'categoria b', 'categoria ab',
  'categoria c', 'categoria d', 'carteira b', 'cnh b', 'habilitacao b',
];

/** "SIM", "NÃO" ou null quando não há certeza. Negativas têm precedência. */
export function extractCNH(text: string): 'SIM' | 'NÃO' | null {
  if (!text) return null;
  const n = normalizeText(text);
  if (CNH_NO.some((e) => n.includes(e))) return 'NÃO';
  if (CNH_YES.some((e) => n.includes(e))) return 'SIM';
  return null;
}

export interface ExistingClientData {
  cpf?: string | null;
  cpf_valid?: boolean;
  birth_date?: string | null;
  cnh?: 'SIM' | 'NÃO' | null;
  manual_fields?: string[];
  field_origins?: FieldOrigins;
}

export interface ExtractedClientData {
  cpf: string | null;
  cpf_valid: boolean;
  birth_date: string | null;
  cnh: 'SIM' | 'NÃO' | null;
  cpf_conflict: string | null;
  field_origins: FieldOrigins;
}

export interface ExtractOptions {
  now?: number;
  /** Janela de mensagens consideradas (padrão 10 min). Infinity analisa todo o histórico. */
  windowMs?: number;
  /** Máximo de mensagens mais recentes analisadas (padrão 20). */
  maxMessages?: number;
}

/**
 * Extrai dados das mensagens do cliente respeitando as prioridades:
 * campo MANUAL nunca é alterado; valor existente nunca é apagado por vazio;
 * CPF válido diferente do já cadastrado gera conflito para revisão, sem sobrescrever.
 */
export function extractClientData(
  messages: ClientMessage[],
  existing: ExistingClientData = {},
  opts: ExtractOptions = {},
): ExtractedClientData {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const recent = messages
    .filter((m) => m.text && (windowMs === Infinity || m.timestamp >= now - windowMs))
    .slice(-(opts.maxMessages ?? 20));

  const ref = new Date(now);
  let cpf: string | undefined;
  let birth: string | undefined;
  let cnh: 'SIM' | 'NÃO' | undefined;

  const scan = (text: string) => {
    if (!cpf) {
      const r = extractCPF(text);
      if (r?.valid) cpf = r.formatted;
    }
    if (!birth) {
      const r = extractBirthDate(text, ref);
      if (r?.valid) birth = r.formatted;
    }
    if (!cnh) cnh = extractCNH(text) ?? undefined;
  };
  recent.forEach((m) => scan(m.text));
  if (!cpf || !birth || !cnh) scan(recent.map((m) => m.text).join(' \n '));

  const manual = new Set(existing.manual_fields ?? []);
  const origins: FieldOrigins = { ...(existing.field_origins ?? {}) };
  const isManual = (f: 'cpf' | 'birth_date' | 'cnh') => manual.has(f) || origins[f] === 'MANUAL';

  const out: ExtractedClientData = {
    cpf: existing.cpf ?? null,
    cpf_valid: Boolean(existing.cpf_valid),
    birth_date: existing.birth_date ?? null,
    cnh: existing.cnh ?? null,
    cpf_conflict: null,
    field_origins: origins,
  };

  if (isManual('cpf')) {
    origins.cpf = 'MANUAL';
  } else if (cpf) {
    const current = cleanCPF(existing.cpf);
    if (current && validateCPF(current)) {
      if (current !== cleanCPF(cpf)) {
        out.cpf_conflict = `Lead já possui o CPF ${existing.cpf} e o cliente enviou outro CPF válido: ${cpf}.`;
      }
      origins.cpf ??= 'LOCAL';
    } else {
      out.cpf = cpf;
      out.cpf_valid = true;
      origins.cpf = 'LOCAL';
    }
  }

  if (isManual('birth_date')) origins.birth_date = 'MANUAL';
  else if (birth) {
    out.birth_date = birth;
    origins.birth_date = 'LOCAL';
  }

  if (isManual('cnh')) origins.cnh = 'MANUAL';
  else if (cnh) {
    out.cnh = cnh;
    origins.cnh = 'LOCAL';
  }

  return out;
}
