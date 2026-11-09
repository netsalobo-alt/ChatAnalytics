import { useState, type ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import { api, qs } from '../lib/api.ts';
import { dayKey } from '../../shared/dates.ts';
import { useAsync } from '../lib/hooks.ts';
import { dateShort, dateTime, money, monthLabel, number, percent, ratio } from '../lib/format.ts';
import { Button, Card, ErrorNote, Input, PageHeader, Segmented, Select, Skeleton, cx, statusColor } from '../components/ui.tsx';
import { Meter } from '../components/charts.tsx';
import { LEAD_STATUSES, STATUS_LABEL, type Inbox, type Period, type Report, type ReportGroup } from '../../shared/types.ts';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'last_30_days', label: '30 dias' },
  { value: 'this_year', label: 'Ano' },
  { value: 'custom', label: 'Datas' },
];

const today = () => dayKey();

export default function Reports() {
  const [period, setPeriod] = useState<Period>('this_month');
  const [start, setStart] = useState(today().slice(0, 8) + '01');
  const [end, setEnd] = useState(today());
  const [inbox, setInbox] = useState('');
  const params = { period, start: period === 'custom' ? start : undefined, end: period === 'custom' ? end : undefined, inbox_id: inbox };
  const report = useAsync(() => api.get<Report>(`/reports${qs(params)}`), [period, start, end, inbox]);
  const inboxes = useAsync(() => api.get<Inbox[]>('/inboxes'), []);
  const r = report.data;
  const a = r?.analytics;
  const inboxName = inboxes.data?.find((i) => String(i.id) === inbox);
  const rangeText = a
    ? a.range.start === a.range.end
      ? dateShort(`${a.range.start}T12:00:00Z`)
      : `${dateShort(`${a.range.start}T12:00:00Z`)} a ${dateShort(`${a.range.end}T12:00:00Z`)} de ${a.range.end.slice(0, 4)}`
    : '';

  return (
    <div className="report">
      <div className="no-print">
        <PageHeader
          title="Relatórios"
          subtitle="Resumo do período para reuniões e acompanhamento. Imprima ou salve em PDF."
          actions={
            <>
              <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = `/api/leads/export.csv${qs(params)}`)}>CSV</Button>
              <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()} disabled={!r}>Imprimir ou PDF</Button>
            </>
          }
        />
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Segmented options={PERIODS} value={period} onChange={setPeriod} />
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="!h-9 !w-auto rounded-full !text-[13px]" aria-label="Data inicial" />
              <span className="text-label-3">até</span>
              <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="!h-9 !w-auto rounded-full !text-[13px]" aria-label="Data final" />
            </div>
          )}
          <Select value={inbox} onChange={(e) => setInbox(e.target.value)} className="!h-9 !w-auto rounded-full !text-[13px]" aria-label="Caixa">
            <option value="">Todas as caixas</option>
            {inboxes.data?.map((i) => <option key={i.id} value={i.id}>{i.custom_name || i.name}</option>)}
          </Select>
        </div>
      </div>

      {/* Cabeçalho que só aparece na impressão */}
      <header className="print-only mb-6 border-b border-separator pb-4">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-9 rounded-[9px]" />
          <div>
            <h1 className="display text-[22px] font-bold">Relatório de leads e vendas</h1>
            <p className="text-[13px] text-label-2">
              {rangeText}{inboxName ? ` · ${inboxName.custom_name || inboxName.name}` : ' · todas as caixas'} · gerado em {dateTime(new Date().toISOString())}
            </p>
          </div>
        </div>
      </header>

      {report.error && <ErrorNote message={report.error} onRetry={report.reload} />}
      {!r || !a ? (
        <div className="space-y-4"><Skeleton className="h-40 rounded-[20px]" /><Skeleton className="h-64 rounded-[20px]" /></div>
      ) : (
        <div className="space-y-4">
          <Card title="Resumo" subtitle={<span className="no-print">{rangeText}</span>}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
              <Figure label="Leads" value={number(a.leads.value)} prev={a.leads.previous} fmt={number} />
              <Figure label="Vendas" value={number(a.sales.value)} prev={a.sales.previous} fmt={number} />
              <Figure label="Receita" value={money(a.revenue.value)} prev={a.revenue.previous} fmt={money} />
              <Figure label="Ticket médio" value={a.ticket ? money(a.ticket) : '—'} />
              <Figure label="Conversão" value={percent(a.conversion.value)} prev={a.conversion.previous} fmt={(v) => percent(v)} />
              <Figure label="Aprovação" value={percent(a.approval.value)} prev={a.approval.previous} fmt={(v) => percent(v)} />
              <Figure label="Investido" value={money(a.invested.value)} prev={a.invested.previous} fmt={money} />
              <Figure label="Custo por lead" value={a.cpl ? money(a.cpl) : '—'} />
              <Figure label="Custo por venda" value={a.cac ? money(a.cac) : '—'} />
              <Figure label="Retorno (ROAS)" value={a.roas ? ratio(a.roas) : '—'} tone={a.roas ? (a.roas >= 1 ? 'green' : 'red') : undefined} />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Funil de qualificação">
              <div className="space-y-3">
                {LEAD_STATUSES.map((s) => {
                  const n = a.status[s];
                  return (
                    <div key={s}>
                      <div className="mb-1 flex justify-between text-[14px]">
                        <span className="flex items-center gap-2"><i className={cx('size-2.5 rounded-full', statusColor(s).dot)} />{STATUS_LABEL[s]}</span>
                        <span className="tabular"><b>{number(n)}</b> <span className="text-label-3">· {percent(a.leads.value ? (n / a.leads.value) * 100 : 0, 0)}</span></span>
                      </div>
                      <Meter value={n} max={Math.max(1, a.leads.value)} color={`var(--${({ NOVO: 'accent', EM_ANALISE: 'indigo-fill', PENDENTE: 'orange-fill', APROVADO: 'green-fill', REPROVADO: 'red-fill' } as const)[s]})`} />
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Qualidade dos dados" subtitle="Leads do período com cada informação preenchida">
              <div className="space-y-3">
                <Quality label="CPF válido" n={r.quality.cpf} total={r.quality.total} />
                <Quality label="Data de nascimento" n={r.quality.birth} total={r.quality.total} />
                <Quality label="CNH informada" n={r.quality.cnh} total={r.quality.total} />
                {r.quality.conflicts > 0 && (
                  <p className="pt-1 text-[13px] text-orange">{number(r.quality.conflicts)} {r.quality.conflicts === 1 ? 'lead tem' : 'leads têm'} conflito de CPF para revisar.</p>
                )}
              </div>
            </Card>
          </div>

          <Card title="Canais de entrada">
            <Table
              head={['Caixa', 'Leads', 'Participação', 'Vendas', 'Conversão', 'Receita']}
              rows={a.channels.map((c) => [c.name, number(c.leads), percent(c.share), number(c.sales), percent(c.conversion), money(c.revenue)])}
              empty="Nenhum lead no período."
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Vendedores"><GroupTable rows={r.sellers} /></Card>
            <Card title="Lojas"><GroupTable rows={r.stores} /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Criativos" subtitle="Desempenho por anúncio de origem"><GroupTable rows={r.creatives} /></Card>
            <Card title="Veículos de interesse"><GroupTable rows={r.vehicles} /></Card>
          </div>

          <Card title="Motivos de reprovação">
            {r.rejections.length === 0 ? (
              <p className="py-4 text-center text-[14px] text-label-3">Nenhuma reprovação no período.</p>
            ) : (
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {r.rejections.map((x) => (
                  <div key={x.reason}>
                    <div className="mb-1 flex justify-between text-[14px]"><span>{x.reason}</span><b className="tabular">{number(x.count)}</b></div>
                    <Meter value={x.count} max={r.rejections[0].count} color="var(--red-fill)" />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Evolução mensal" subtitle="Últimos 12 meses (não depende do período escolhido)">
            <Table
              head={['Mês', 'Leads', 'Vendas', 'Receita', 'Investido', 'CPL', 'CAC', 'ROAS']}
              rows={a.months.slice().reverse().filter((m) => m.leads || m.sales || m.invested).map((m) => [
                <span className="capitalize">{monthLabel(m.month)}</span>, number(m.leads), number(m.sales), money(m.revenue), money(m.invested),
                m.cpl ? money(m.cpl) : '—', m.cac ? money(m.cac) : '—', m.roas ? ratio(m.roas) : '—',
              ])}
              empty="Sem histórico ainda."
            />
          </Card>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, prev, fmt, tone }: { label: string; value: string; prev?: number; fmt?: (v: number) => string; tone?: 'green' | 'red' }) {
  return (
    <div>
      <div className="text-[13px] text-label-2">{label}</div>
      <div className={cx('display mt-0.5 text-[22px] font-semibold tabular', tone === 'green' && 'text-green', tone === 'red' && 'text-red')}>{value}</div>
      {prev !== undefined && fmt && <div className="text-[12px] text-label-3">Período anterior: {fmt(prev)}</div>}
    </div>
  );
}

function Quality({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? (n / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[14px]">
        <span>{label}</span>
        <span className="tabular"><b>{percent(pct, 0)}</b> <span className="text-label-3">· {number(n)} de {number(total)}</span></span>
      </div>
      <Meter value={n} max={Math.max(1, total)} color={pct >= 60 ? 'var(--green-fill)' : pct >= 30 ? 'var(--orange-fill)' : 'var(--red-fill)'} />
    </div>
  );
}

function GroupTable({ rows }: { rows: ReportGroup[] }) {
  return (
    <Table
      head={['Nome', 'Leads', 'Vendas', 'Conversão', 'Receita']}
      rows={rows.map((g) => [
        <span className={g.name.startsWith('Sem ') ? 'text-label-3' : ''}>{g.name}</span>,
        number(g.leads), number(g.sales), percent(g.leads ? (g.sales / g.leads) * 100 : 0), money(g.revenue),
      ])}
      empty="Nenhum lead no período."
    />
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-[14px] text-label-3">{empty}</p>;
  return (
    <div className="-mx-6 overflow-x-auto px-6">
      <table className="w-full min-w-[480px] text-[14px]">
        <thead>
          <tr className="border-b border-separator text-[12px] text-label-3">
            {head.map((h, i) => <th key={h} className={cx('pb-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-separator last:border-0">
              {row.map((cell, i) => <td key={i} className={cx('py-2.5 tabular', i === 0 ? 'pr-3 text-left font-medium' : 'pl-3 text-right')}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
