import { useState } from 'react';
import { Cable, RefreshCw, Sparkles } from 'lucide-react';
import { api, qs } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { can, useSession } from '../lib/session.tsx';
import { axisLabel, dateShort, money, moneyShort, monthLabel, number, percent, ratio, relative } from '../lib/format.ts';
import { Button, Card, Change, ErrorNote, PageHeader, Segmented, Select, Skeleton, cx, statusColor, useToast } from '../components/ui.tsx';
import { Meter, MiniBars, Ring, TrendChart } from '../components/charts.tsx';
import { LEAD_STATUSES, STATUS_LABEL, type Analytics, type ChatwootSettings, type Inbox, type Kpi, type Period } from '../../shared/types.ts';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'last_7_days', label: '7 dias' },
  { value: 'last_30_days', label: '30 dias' },
  { value: 'this_month', label: 'Mês' },
  { value: 'this_year', label: 'Ano' },
];

const STATUS_HEX: Record<string, string> = {
  NOVO: 'var(--accent)',
  EM_ANALISE: 'var(--indigo-fill)',
  PENDENTE: 'var(--orange-fill)',
  APROVADO: 'var(--green-fill)',
  REPROVADO: 'var(--red-fill)',
};

export default function Dashboard() {
  const { user } = useSession();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('last_30_days');
  const [inbox, setInbox] = useState('');
  const [syncing, setSyncing] = useState(false);

  const analytics = useAsync(() => api.get<Analytics>(`/analytics${qs({ period, inbox_id: inbox })}`), [period, inbox]);
  const inboxes = useAsync(() => api.get<Inbox[]>('/inboxes'), []);
  const settings = useAsync(() => api.get<ChatwootSettings>('/settings'), []);
  const a = analytics.data;
  const connected = Boolean(settings.data?.has_token && settings.data.chatwoot_url);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post<{ message: string }>('/sync');
      toast('success', r.message);
      analytics.reload();
      settings.reload();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const rangeText = a
    ? a.range.start === a.range.end
      ? dateShort(`${a.range.start}T12:00:00Z`)
      : `${dateShort(`${a.range.start}T12:00:00Z`)} – ${dateShort(`${a.range.end}T12:00:00Z`)}`
    : '';

  return (
    <>
      <PageHeader
        title="Painel"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{rangeText || 'Visão geral de leads e vendas'}</span>
            {settings.data?.last_sync_at && (
              <span className="text-label-3">· Chatwoot atualizado {relative(settings.data.last_sync_at)}</span>
            )}
          </span>
        }
        actions={
          <>
            <Segmented options={PERIODS} value={period} onChange={setPeriod} />
            {inboxes.data && inboxes.data.length > 1 && (
              <Select value={inbox} onChange={(e) => setInbox(e.target.value)} className="!h-9 !w-auto min-w-[150px] rounded-full !text-[13px]" aria-label="Caixa de entrada">
                <option value="">Todas as caixas</option>
                {inboxes.data.filter((i) => i.enabled).map((i) => (
                  <option key={i.id} value={i.id}>{i.custom_name || i.name}</option>
                ))}
              </Select>
            )}
            {can(user, 'manager') && connected && (
              <Button onClick={sync} loading={syncing} icon={<RefreshCw className="size-4" />}>Sincronizar</Button>
            )}
          </>
        }
      />

      {settings.data && !connected && a?.leads.value === 0 && <ConnectHero canEdit={can(user, 'manager')} />}
      {analytics.error && <ErrorNote message={analytics.error} onRetry={analytics.reload} />}

      {/* Indicadores principais */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile label="Leads" kpi={a?.leads} format={number} spark={a?.series.map((s) => s.leads)} color="var(--accent)" />
        <KpiTile label="Vendas" kpi={a?.sales} format={number} spark={a?.series.map((s) => s.sales)} color="var(--green-fill)" />
        <KpiTile label="Receita" kpi={a?.revenue} format={moneyShort} hint={a && a.ticket ? `Ticket médio ${money(a.ticket)}` : undefined} />
        <KpiTile label="Conversão" kpi={a?.conversion} format={(v) => percent(v)} hint={a ? `Aprovação ${percent(a.approval.value)}` : undefined} />
      </div>

      {/* Investimento */}
      <Card className="mt-4" bodyClass="!py-0">
        <div className="grid grid-cols-2 divide-separator sm:grid-cols-4 sm:divide-x [&>*]:py-5">
          <Metric label="Investido" value={a ? moneyShort(a.invested.value) : null} sub={a ? <Change value={a.invested.change} invert /> : null} />
          <Metric label="Custo por lead" value={a ? (a.cpl ? money(a.cpl) : '—') : null} sub="CPL" />
          <Metric label="Custo por venda" value={a ? (a.cac ? money(a.cac) : '—') : null} sub="CAC" />
          <Metric label="Retorno" value={a ? (a.roas ? ratio(a.roas) : '—') : null} sub="ROAS" accent={a ? (a.roas >= 1 ? 'green' : a.roas > 0 ? 'red' : undefined) : undefined} />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Leads e vendas"
          subtitle={a?.series_bucket === 'month' ? 'Por mês' : 'Por dia'}
          action={
            <div className="flex items-center gap-4 text-[12px] text-label-2">
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded-full bg-accent" />Leads</span>
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-green-fill" />Vendas</span>
            </div>
          }
        >
          {a ? (
            <TrendChart
              data={a.series.map((s) => ({ key: s.date, label: axisLabel(s.date, a.series_bucket), a: s.leads, b: s.sales }))}
              height={290}
              aLabel="Leads"
              bLabel="Vendas"
              format={(v) => number(v)}
            />
          ) : (
            <Skeleton className="h-[290px]" />
          )}
        </Card>

        <Card title="Funil de qualificação" subtitle="Status dos leads do período">
          {a ? (
            <div className="flex flex-col items-center gap-6 sm:flex-row xl:flex-col 2xl:flex-row">
              <Ring
                segments={LEAD_STATUSES.map((s) => ({ value: a.status[s], color: STATUS_HEX[s], label: STATUS_LABEL[s] }))}
                center={
                  <>
                    <span className="display text-[30px] font-bold tabular leading-none">{number(a.leads.value)}</span>
                    <span className="mt-1 text-[12px] text-label-3">leads</span>
                  </>
                }
              />
              <ul className="w-full space-y-2.5">
                {LEAD_STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between text-[14px]">
                    <span className="flex items-center gap-2 text-label-2">
                      <i className={cx('size-2.5 rounded-full', statusColor(s).dot)} />
                      {STATUS_LABEL[s]}
                    </span>
                    <span className="font-semibold tabular">{number(a.status[s])}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Skeleton className="h-[220px]" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Canais de entrada" subtitle="Volume, conversão e receita por caixa">
          {!a ? (
            <Skeleton className="h-40" />
          ) : a.channels.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-label-3">Nenhum lead no período.</p>
          ) : (
            <div className="-mx-2">
              <div className="grid grid-cols-[1fr_64px_72px_96px] gap-3 px-2 pb-2 text-[12px] font-medium text-label-3 sm:grid-cols-[1fr_72px_80px_110px]">
                <span>Caixa</span><span className="text-right">Leads</span><span className="text-right">Conversão</span><span className="text-right">Receita</span>
              </div>
              {a.channels.slice(0, 8).map((c) => (
                <div key={c.key} className="grid grid-cols-[1fr_64px_72px_96px] items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-fill-2 sm:grid-cols-[1fr_72px_80px_110px]">
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[14px] font-medium">{c.name}</span>
                      <span className="text-[12px] text-label-3 tabular">{percent(c.share, 0)}</span>
                    </div>
                    <Meter value={c.share} max={100} className="mt-1.5" />
                  </div>
                  <span className="text-right text-[14px] font-semibold tabular">{number(c.leads)}</span>
                  <span className="text-right text-[14px] tabular text-label-2">{percent(c.conversion)}</span>
                  <span className="text-right text-[14px] tabular">{moneyShort(c.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2" title="Últimos 12 meses" subtitle="Vendas, receita e retorno">
          {!a ? (
            <Skeleton className="h-40" />
          ) : (
            <MonthsTable months={a.months} />
          )}
        </Card>
      </div>
    </>
  );
}

function KpiTile({ label, kpi, format, spark, color, hint }: { label: string; kpi?: Kpi; format: (v: number) => string; spark?: number[]; color?: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-label-2">{label}</span>
        {kpi && <Change value={kpi.change} />}
      </div>
      {kpi ? (
        <div className="display mt-2 truncate text-[23px] font-bold tabular leading-tight sm:text-[34px]">{format(kpi.value)}</div>
      ) : (
        <Skeleton className="mt-3 h-9 w-24" />
      )}
      <div className="mt-3 flex h-9 items-end">
        {spark && spark.length > 1 ? (
          <div className="w-full"><MiniBars values={spark.slice(-14)} color={color} height={28} /></div>
        ) : (
          <span className="text-[12px] text-label-3">{hint ?? (kpi ? `Antes: ${format(kpi.previous)}` : '')}</span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string | null; sub?: React.ReactNode; accent?: 'green' | 'red' }) {
  return (
    <div className="px-1 sm:px-5 sm:first:pl-0">
      <div className="text-[13px] text-label-2">{label}</div>
      {value === null ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div className={cx('display mt-1 text-[22px] font-semibold tabular', accent === 'green' && 'text-green', accent === 'red' && 'text-red')}>{value}</div>
      )}
      {sub && <div className="mt-0.5 text-[12px] text-label-3">{sub}</div>}
    </div>
  );
}

function MonthsTable({ months }: { months: Analytics['months'] }) {
  const rows = months.filter((m) => m.leads || m.sales || m.invested).slice(-6).reverse();
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));
  if (!rows.length) return <p className="py-8 text-center text-[14px] text-label-3">Sem histórico ainda.</p>;
  return (
    <div className="space-y-1">
      {rows.map((m) => (
        <div key={m.month} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 rounded-xl px-2 py-2 hover:bg-fill-2">
          <span className="text-[13px] font-medium capitalize text-label-2">{monthLabel(m.month)}</span>
          <div className="min-w-0">
            <div className="flex items-center justify-between text-[12px] text-label-3">
              <span className="tabular">{number(m.leads)} leads · {number(m.sales)} vendas</span>
              {m.roas > 0 && <span className={cx('font-semibold tabular', m.roas >= 1 ? 'text-green' : 'text-red')}>{ratio(m.roas)}</span>}
            </div>
            <Meter value={m.revenue} max={maxRevenue} color="var(--green-fill)" className="mt-1.5" />
          </div>
          <span className="w-[76px] text-right text-[14px] font-semibold tabular">{moneyShort(m.revenue)}</span>
        </div>
      ))}
    </div>
  );
}

function ConnectHero({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="mb-6 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-card">
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-[#2997ff] to-[#0058c4] text-white shadow-[0_8px_24px_rgba(0,113,227,0.3)]">
          <Sparkles className="size-7" />
        </div>
        <div className="flex-1">
          <h2 className="display text-[20px] font-semibold">Conecte o Chatwoot para começar</h2>
          <p className="mt-1 text-[15px] text-label-2">
            Os leads chegam pelo webhook em tempo real e pela sincronização automática. CPF, nascimento e CNH são identificados sozinhos nas mensagens.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" size="lg" icon={<Cable className="size-4" />} onClick={() => (window.location.hash = '/integracao')}>
            Configurar integração
          </Button>
        )}
      </div>
    </div>
  );
}
