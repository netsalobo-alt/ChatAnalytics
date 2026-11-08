import { useState } from 'react';
import { Check, Pencil, RefreshCw, Waypoints } from 'lucide-react';
import { api, qs } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { can, useSession } from '../lib/session.tsx';
import { moneyShort, number, percent } from '../lib/format.ts';
import { Button, Card, Empty, ErrorNote, IconButton, Input, PageHeader, Segmented, Skeleton, Tag, Toggle, useToast } from '../components/ui.tsx';
import { Meter } from '../components/charts.tsx';
import type { Analytics, Inbox, Period } from '../../shared/types.ts';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'last_7_days', label: '7 dias' },
  { value: 'last_30_days', label: '30 dias' },
  { value: 'this_month', label: 'Mês' },
  { value: 'this_year', label: 'Ano' },
  { value: 'all', label: 'Tudo' },
];

export default function Channels() {
  const { user } = useSession();
  const toast = useToast();
  const editable = can(user, 'manager');
  const [period, setPeriod] = useState<Period>('last_30_days');
  const inboxes = useAsync(() => api.get<Inbox[]>('/inboxes'), []);
  const stats = useAsync(() => api.get<Analytics>(`/analytics${qs({ period })}`), [period]);
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const update = async (id: number, body: Partial<Inbox>, message: string) => {
    try {
      const ib = await api.patch<Inbox>(`/inboxes/${id}`, body);
      inboxes.setData((list) => list?.map((i) => (i.id === id ? ib : i)) ?? null);
      toast('success', message);
      stats.reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      inboxes.setData(await api.post<Inbox[]>('/inboxes/refresh'));
      toast('success', 'Caixas atualizadas a partir do Chatwoot.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const rowFor = (ib: Inbox) => stats.data?.channels.find((c) => c.key === `inbox:${ib.id}`);
  const maxLeads = Math.max(1, ...(stats.data?.channels.map((c) => c.leads) ?? [1]));

  return (
    <>
      <PageHeader
        title="Canais"
        subtitle="Caixas de entrada do Chatwoot. Caixas desligadas não geram leads nem entram nos relatórios."
        actions={
          <>
            <Segmented options={PERIODS} value={period} onChange={setPeriod} />
            {editable && <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={refresh}>Atualizar caixas</Button>}
          </>
        }
      />
      {inboxes.error && <ErrorNote message={inboxes.error} onRetry={inboxes.reload} />}
      {!inboxes.data ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-[20px]" />)}</div>
      ) : inboxes.data.length === 0 ? (
        <Card>
          <Empty icon={<Waypoints className="size-7" />} title="Nenhuma caixa ainda">
            As caixas aparecem depois que a integração com o Chatwoot estiver configurada.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {inboxes.data.map((ib) => {
            const r = rowFor(ib);
            return (
              <section key={ib.id} className={`rounded-[20px] bg-surface p-5 shadow-card transition-opacity ${ib.enabled ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editing === ib.id ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setEditing(null);
                          update(ib.id, { custom_name: name }, 'Nome atualizado.');
                        }}
                      >
                        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={ib.name} className="!h-9" />
                        <IconButton label="Salvar nome" type="submit" className="bg-accent !text-white hover:!bg-accent-hover"><Check className="size-4" /></IconButton>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <h3 className="display truncate text-[17px] font-semibold">{ib.custom_name || ib.name}</h3>
                        {editable && (
                          <IconButton label="Renomear" onClick={() => { setEditing(ib.id); setName(ib.custom_name ?? ''); }}>
                            <Pencil className="size-3.5" />
                          </IconButton>
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-label-3">
                      <Tag>{ib.channel_type.replace('Channel::', '') || 'Caixa'}</Tag>
                      {ib.custom_name && <span>Chatwoot: {ib.name}</span>}
                      <span>#{ib.id}</span>
                    </div>
                  </div>
                  <Toggle
                    label={ib.enabled ? 'Desligar caixa' : 'Ligar caixa'}
                    checked={ib.enabled}
                    disabled={!editable}
                    onChange={(v) => update(ib.id, { enabled: v }, v ? 'Caixa ligada.' : 'Caixa desligada.')}
                  />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <Stat label="Leads" value={r ? number(r.leads) : '0'} />
                  <Stat label="Conversão" value={r ? percent(r.conversion) : '—'} />
                  <Stat label="Receita" value={r ? moneyShort(r.revenue) : '—'} />
                </div>
                <Meter value={r?.leads ?? 0} max={maxLeads} className="mt-4" />
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[12px] text-label-3">{label}</div>
      <div className="display mt-0.5 text-[20px] font-semibold tabular">{value}</div>
    </div>
  );
}
