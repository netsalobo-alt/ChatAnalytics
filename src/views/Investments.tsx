import { useState } from 'react';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { dayKey } from '../../shared/dates.ts';
import { useAsync } from '../lib/hooks.ts';
import { money, moneyShort, monthLabel, ratio } from '../lib/format.ts';
import { Button, Card, Dialog, Empty, ErrorNote, Field, IconButton, Input, PageHeader, Skeleton, Tag, useToast, cx } from '../components/ui.tsx';
import type { Analytics, Investment } from '../../shared/types.ts';

const SUGGESTED = ['Meta Ads', 'Google Ads', 'TikTok Ads', 'Geral'];

export default function Investments() {
  const toast = useToast();
  const list = useAsync(() => api.get<Investment[]>('/investments'), []);
  const year = useAsync(() => api.get<Analytics>('/analytics?period=this_year'), []);
  const [editing, setEditing] = useState<Investment | 'new' | null>(null);
  const [removing, setRemoving] = useState<Investment | null>(null);

  const reload = () => {
    list.reload();
    year.reload();
  };

  const remove = async () => {
    if (!removing) return;
    try {
      await api.del(`/investments/${removing.id}`);
      toast('success', 'Lançamento excluído.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const months = year.data?.months.filter((m) => m.invested || m.revenue).slice(-6) ?? [];
  const maxBar = Math.max(1, ...months.map((m) => Math.max(m.invested, m.revenue)));

  return (
    <>
      <PageHeader
        title="Investimentos"
        subtitle="Lance o valor investido em tráfego pago para calcular custo por lead, custo por venda e retorno."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo lançamento</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2" title="Investido x receita" subtitle="Últimos meses com movimento">
          {!year.data ? (
            <Skeleton className="h-52" />
          ) : months.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-label-3">Sem lançamentos ainda.</p>
          ) : (
            <div className="space-y-4">
              {months.map((m) => (
                <div key={m.month}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-medium capitalize">{monthLabel(m.month)}</span>
                    <span className={cx('font-semibold tabular', m.roas >= 1 ? 'text-green' : m.roas > 0 ? 'text-red' : 'text-label-3')}>
                      {m.roas ? `ROAS ${ratio(m.roas)}` : '—'}
                    </span>
                  </div>
                  <Bar value={m.invested} max={maxBar} color="var(--orange-fill)" label={moneyShort(m.invested)} />
                  <Bar value={m.revenue} max={maxBar} color="var(--green-fill)" label={moneyShort(m.revenue)} />
                </div>
              ))}
              <div className="flex gap-4 pt-1 text-[12px] text-label-2">
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-orange-fill" />Investido</span>
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-green-fill" />Receita</span>
              </div>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-3" title="Lançamentos" bodyClass="!px-0 !pb-2">
          {list.error && <div className="px-6"><ErrorNote message={list.error} onRetry={list.reload} /></div>}
          {!list.data ? (
            <div className="space-y-2 px-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : list.data.length === 0 ? (
            <Empty icon={<Megaphone className="size-7" />} title="Nenhum investimento lançado" action={<Button variant="tinted" onClick={() => setEditing('new')}>Lançar o primeiro</Button>}>
              Sem investimentos, CPL, CAC e ROAS ficam em branco.
            </Empty>
          ) : (
            <ul>
              {list.data.map((inv) => (
                <li key={inv.id} className="group flex items-center gap-4 border-t border-separator px-6 py-3 first:border-0 hover:bg-fill-2">
                  <div className="w-16 shrink-0 text-[13px] text-label-2 tabular">
                    {new Date(`${inv.date}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Tag tone="accent">{inv.channel}</Tag>
                    {inv.notes && <span className="ml-2 truncate text-[13px] text-label-3">{inv.notes}</span>}
                  </div>
                  <div className="text-[15px] font-semibold tabular">{money(inv.amount)}</div>
                  <div className="flex opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <IconButton label="Editar" onClick={() => setEditing(inv)}><Pencil className="size-4" /></IconButton>
                    <IconButton label="Excluir" onClick={() => setRemoving(inv)} className="hover:!text-red"><Trash2 className="size-4" /></IconButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && <InvestmentDialog initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {removing && (
        <Dialog title="Excluir lançamento?" onClose={() => setRemoving(null)} footer={<><Button onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="destructive" onClick={remove}>Excluir</Button></>}>
          <p className="text-[15px] text-label-2">{money(removing.amount)} em {removing.channel}. Os indicadores serão recalculados.</p>
        </Dialog>
      )}
    </>
  );
}

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-fill-2">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
      <span className="w-16 text-right text-[12px] text-label-2 tabular">{label}</span>
    </div>
  );
}

function InvestmentDialog({ initial, onClose, onSaved }: { initial: Investment | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(initial?.date ?? dayKey());
  const [amount, setAmount] = useState(initial ? String(initial.amount).replace('.', ',') : '');
  const [channel, setChannel] = useState(initial?.channel ?? 'Meta Ads');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const value = Number(amount.replace(/\./g, '').replace(',', '.'));
    setBusy(true);
    try {
      const body = { date, amount: value, channel, notes };
      if (initial) await api.put(`/investments/${initial.id}`, body);
      else await api.post('/investments', body);
      toast('success', initial ? 'Lançamento atualizado.' : 'Investimento lançado.');
      onSaved();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={initial ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} loading={busy} disabled={!amount}>Salvar</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valor (R$)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" autoFocus /></Field>
        </div>
        <Field label="Plataforma">
          <Input value={channel} onChange={(e) => setChannel(e.target.value)} list="inv-channels" />
          <datalist id="inv-channels">{SUGGESTED.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Observação (opcional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Campanha, conjunto…" /></Field>
      </div>
    </Dialog>
  );
}
