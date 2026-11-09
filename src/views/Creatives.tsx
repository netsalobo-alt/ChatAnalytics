import { useState } from 'react';
import { Check, ExternalLink, ImageOff, Megaphone, Pencil, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useLive } from '../lib/live.ts';
import { money, moneyShort, number, percent, relative } from '../lib/format.ts';
import { Button, Card, Dialog, Empty, ErrorNote, IconButton, Input, PageHeader, Segmented, Skeleton, Tag, cx, useToast } from '../components/ui.tsx';
import { Meter } from '../components/charts.tsx';
import type { Ad, BackfillStatus, Period } from '../../shared/types.ts';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'last_7_days', label: '7 dias' },
  { value: 'last_30_days', label: '30 dias' },
  { value: 'this_month', label: 'Mês' },
  { value: 'this_year', label: 'Ano' },
  { value: 'all', label: 'Tudo' },
];

interface AdsResponse {
  ads: Ad[];
  without_ad: { leads: number; sales: number; revenue: number };
  backfill: BackfillStatus;
}

export default function Creatives() {
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('last_30_days');
  const data = useAsync(() => api.get<AdsResponse>(`/ads${qs({ period })}`), [period]);
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null);
  const [asking, setAsking] = useState(false);

  useLive(['lead', 'sync'], data.reload, 1500);
  useLive(['backfill'], () => api.get<BackfillStatus>('/ads/backfill').then(setBackfill).catch(() => {}), 200);

  const bf = backfill ?? data.data?.backfill ?? null;
  const ads = data.data?.ads ?? [];
  const visible = ads.filter((a) => a.leads > 0 || period === 'all');
  const adLeads = visible.reduce((s, a) => s + a.leads, 0);
  const organic = data.data?.without_ad.leads ?? 0;
  const maxLeads = Math.max(1, ...visible.map((a) => a.leads));

  const start = async (days: number) => {
    setAsking(false);
    try {
      setBackfill(await api.post<BackfillStatus>('/ads/backfill', { days }));
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Criativos"
        subtitle="Anúncios de onde os clientes vieram, identificados automaticamente nas conversas do Chatwoot."
        actions={
          <>
            <Segmented options={PERIODS} value={period} onChange={setPeriod} />
            <Button icon={<RefreshCw className={cx('size-4', bf?.running && 'animate-spin')} />} disabled={bf?.running} onClick={() => setAsking(true)}>
              {bf?.running ? 'Reprocessando…' : 'Reprocessar conversas'}
            </Button>
          </>
        }
      />

      {bf && (bf.running || bf.finished_at) && <BackfillBanner status={bf} />}
      {data.error && <ErrorNote message={data.error} onRetry={data.reload} />}

      {!data.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-[20px]" />)}</div>
      ) : (
        <>
          <Card className="mb-4" bodyClass="!py-5">
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <Figure label="Leads de anúncio" value={number(adLeads)} />
              <Figure label="Sem anúncio identificado" value={number(organic)} />
              <Figure label="Participação dos anúncios" value={percent(adLeads + organic ? (adLeads / (adLeads + organic)) * 100 : 0, 0)} />
              <Figure label="Anúncios ativos no período" value={number(visible.filter((a) => a.leads > 0).length)} />
              <div className="min-w-[200px] flex-1">
                <Meter value={adLeads} max={Math.max(1, adLeads + organic)} />
                <div className="mt-1.5 flex justify-between text-[12px] text-label-3"><span>Anúncio</span><span>Sem anúncio</span></div>
              </div>
            </div>
          </Card>

          {visible.length === 0 ? (
            <Card>
              <Empty
                icon={<Megaphone className="size-7" />}
                title="Nenhum anúncio identificado no período"
                action={<Button variant="tinted" onClick={() => setAsking(true)}>Reprocessar conversas</Button>}
              >
                Os anúncios são reconhecidos pela mensagem "📢 ANÚNCIO DO FACEBOOK" que o WAHA envia ao Chatwoot. Para leads anteriores a esta versão, reprocesse as conversas.
              </Empty>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((ad) => (
                <AdCard key={ad.id} ad={ad} maxLeads={maxLeads} onRenamed={data.reload} />
              ))}
            </div>
          )}
        </>
      )}

      {asking && (
        <Dialog
          title="Reprocessar conversas"
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button onClick={() => setAsking(false)}>Cancelar</Button>
              <Button onClick={() => start(30)}>Últimos 30 dias</Button>
              <Button variant="primary" onClick={() => start(90)}>Últimos 90 dias</Button>
            </>
          }
        >
          <p className="text-[15px] text-label-2">
            Relê o histórico das conversas dos leads sem anúncio identificado para encontrar o anúncio de origem e completar CPF, nascimento e CNH.
            Roda em segundo plano, com pausas para não sobrecarregar o Chatwoot. Pode levar alguns minutos.
          </p>
        </Dialog>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[13px] text-label-2">{label}</div>
      <div className="display mt-0.5 text-[22px] font-semibold tabular">{value}</div>
    </div>
  );
}

function BackfillBanner({ status }: { status: BackfillStatus }) {
  const pct = status.total ? (status.done / status.total) * 100 : 100;
  return (
    <div className="mb-4 rounded-2xl bg-accent-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <span className="font-semibold text-accent">
          {status.running ? `Reprocessando conversas… ${number(status.done)} de ${number(status.total)}` : 'Reprocessamento concluído'}
        </span>
        <span className="text-label-2">
          {number(status.found)} vindas de anúncio{status.errors ? ` · ${number(status.errors)} com erro` : ''}
          {!status.running && status.finished_at ? ` · ${relative(status.finished_at)}` : ''}
        </span>
      </div>
      {status.running && <Meter value={pct} max={100} className="mt-3" />}
    </div>
  );
}

function AdCard({ ad, maxLeads, onRenamed }: { ad: Ad; maxLeads: number; onRenamed: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ad.name ?? '');
  const [imgOk, setImgOk] = useState(Boolean(ad.image_url));

  const save = async () => {
    setEditing(false);
    try {
      await api.patch(`/ads/${ad.id}`, { name });
      toast('success', 'Nome do anúncio salvo. Os leads foram atualizados.');
      onRenamed();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-[20px] bg-surface shadow-card">
      <div className="relative aspect-[4/3] overflow-hidden bg-fill-2">
        {imgOk && ad.image_url ? (
          <img src={ad.image_url} alt="" className="absolute inset-0 size-full object-cover object-[center_30%]" loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-label-3"><ImageOff className="size-8" /></div>
        )}
        {ad.platform && <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur">{ad.platform}</span>}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {editing ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ex.: Moto 0km – Sul/Sudeste" className="!h-9" />
            <IconButton label="Salvar nome" type="submit" className="bg-accent !text-white hover:!bg-accent-hover"><Check className="size-4" /></IconButton>
          </form>
        ) : (
          <div className="flex items-start gap-1.5">
            <h3 className="display min-w-0 flex-1 text-[17px] font-semibold leading-snug">{ad.label}</h3>
            <IconButton label="Dar nome ao anúncio" onClick={() => { setName(ad.name ?? ''); setEditing(true); }}><Pencil className="size-3.5" /></IconButton>
          </div>
        )}
        {ad.description && <p className="mt-1.5 line-clamp-2 text-[13px] text-label-2" title={ad.description}>{ad.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-label-3">
          {!ad.name && <Tag tone="orange">sem nome</Tag>}
          <span className="tabular">ID {ad.id}</span>
          {ad.link && (
            <a href={ad.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              Ver anúncio <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <div className="mt-auto pt-5">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Leads" value={number(ad.leads)} />
            <Stat label="Vendas" value={number(ad.sales)} />
            <Stat label="Conversão" value={ad.leads ? percent(ad.conversion, 0) : '—'} />
            <Stat label="Receita" value={ad.revenue ? moneyShort(ad.revenue) : '—'} title={money(ad.revenue)} />
          </div>
          <Meter value={ad.leads} max={maxLeads} className="mt-3" />
          <div className="mt-2 text-[12px] text-label-3">Último lead {relative(ad.last_seen)}</div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <div className="text-[11px] text-label-3">{label}</div>
      <div className="display text-[17px] font-semibold tabular">{value}</div>
    </div>
  );
}
