// Tipos compartilhados entre servidor e interface.

export type Role = 'admin' | 'manager' | 'operator';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  manager: 'Gestor',
  operator: 'Operador',
};

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export const LEAD_STATUSES = ['NOVO', 'EM_ANALISE', 'PENDENTE', 'APROVADO', 'REPROVADO'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  NOVO: 'Novo',
  EM_ANALISE: 'Em análise',
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
};

export const CHANNELS = ['WhatsApp', 'Instagram', 'Facebook', 'Webchat', 'Outros'] as const;
export type Channel = (typeof CHANNELS)[number];

export type FieldOrigin = 'MANUAL' | 'LOCAL';
export type FieldOrigins = Partial<Record<'cpf' | 'birth_date' | 'cnh', FieldOrigin>>;

export interface ClientMessage {
  text: string;
  timestamp: number; // epoch ms
  message_id?: string | number;
}

export interface Lead {
  id: string; // `${account_id}_${contact_id}`
  account_id: string;
  contact_id: number;
  conversation_id: number;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  entry_date: string; // ISO
  last_interaction_at: string; // ISO
  cpf: string | null;
  cpf_valid: boolean;
  birth_date: string | null; // DD/MM/AAAA
  cnh: 'SIM' | 'NÃO' | null;
  status: LeadStatus;
  vendedor: string | null;
  loja: string | null;
  vendeu: boolean;
  valor_venda: number;
  sale_date: string | null; // ISO — quando a venda foi registrada
  observacao: string | null;
  motivo_reprovacao: string | null;
  chatwoot_url: string | null;
  channel: Channel;
  inbox_id: number | null;
  inbox_name: string | null;
  tags: string[];
  last_message: string | null;
  manual_fields: string[];
  field_origins: FieldOrigins;
  cpf_conflict: string | null; // descrição do conflito, quando houver
  created_at: string;
  updated_at: string;
}

export interface LeadDetail extends Lead {
  recent_messages: ClientMessage[];
}

export interface Inbox {
  id: number;
  name: string;
  channel_type: string;
  enabled: boolean;
  custom_name: string | null;
}

export interface Investment {
  id: number;
  date: string; // YYYY-MM-DD
  amount: number;
  channel: string;
  notes: string | null;
  created_at: string;
}

export interface ChatwootSettings {
  chatwoot_url: string;
  account_id: string;
  has_token: boolean;
  token_hint: string;
  auto_sync_enabled: boolean;
  auto_sync_minutes: number;
  labels_on_approve: string;
  labels_on_reject: string;
  webhook_url: string;
  last_sync_at: string | null;
  last_sync_status: 'idle' | 'syncing' | 'success' | 'error';
  last_sync_message: string | null;
}

export interface WebhookLog {
  id: number;
  received_at: string;
  event: string;
  status: 'processed' | 'ignored' | 'error';
  summary: string;
  conversation_id: number | null;
  contact_name: string | null;
  lead_id: string | null;
}

export type Period =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'all'
  | 'custom';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last_7_days: '7 dias',
  last_30_days: '30 dias',
  this_month: 'Este mês',
  last_month: 'Mês passado',
  this_year: 'Este ano',
  all: 'Tudo',
  custom: 'Personalizado',
};

export interface AnalyticsFilter {
  period: Period;
  start?: string; // YYYY-MM-DD (custom)
  end?: string;
  inbox_id?: number;
  channel?: Channel;
}

export interface Kpi {
  value: number;
  previous: number;
  change: number | null; // variação % sobre o período anterior
}

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  leads: number;
  sales: number;
}

export interface ChannelRow {
  key: string;
  name: string;
  channel: Channel;
  leads: number;
  sales: number;
  revenue: number;
  conversion: number;
  share: number;
}

export interface MonthRow {
  month: string; // YYYY-MM
  leads: number;
  sales: number;
  revenue: number;
  invested: number;
  cpl: number;
  cac: number;
  roas: number;
}

export interface Analytics {
  range: { start: string; end: string; days: number };
  leads: Kpi;
  sales: Kpi;
  revenue: Kpi;
  conversion: Kpi; // % de leads do período que venderam
  approval: Kpi; // aprovados / (aprovados + reprovados)
  invested: Kpi;
  cpl: number;
  cac: number;
  roas: number;
  ticket: number;
  status: Record<LeadStatus, number>;
  series: SeriesPoint[];
  series_bucket: 'day' | 'month';
  channels: ChannelRow[];
  months: MonthRow[];
  today: { leads: number; sales: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ReportGroup {
  name: string;
  leads: number;
  sales: number;
  revenue: number;
}

export interface Report {
  analytics: Analytics;
  sellers: ReportGroup[];
  stores: ReportGroup[];
  rejections: { reason: string; count: number }[];
  quality: { total: number; cpf: number; birth: number; cnh: number; conflicts: number };
}
