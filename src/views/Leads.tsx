import { useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Inbox as InboxIcon, Plus, Search } from 'lucide-react';
import { api, qs } from '../lib/api.ts';
import { useAsync, useDebounced } from '../lib/hooks.ts';
import { can, useSession } from '../lib/session.tsx';
import { money, number, phone, relative } from '../lib/format.ts';
import { Avatar, Button, Card, Dialog, Empty, ErrorNote, Field, Input, PageHeader, Select, Skeleton, StatusPill, Tag, useToast, cx } from '../components/ui.tsx';
import LeadSheet from './LeadSheet.tsx';
import { CHANNELS, LEAD_STATUSES, PERIOD_LABEL, STATUS_LABEL, type Channel, type Inbox, type Lead, type LeadStatus, type Paged, type Period } from '../../shared/types.ts';

const PERIOD_OPTIONS: Period[] = ['all', 'today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'this_year'];

export default function Leads() {
  const { user } = useSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [period, setPeriod] = useState<Period>('all');
  const [inbox, setInbox] = useState('');
  const [vendeu, setVendeu] = useState('');
  const [conflict, setConflict] = useState(false);
  const [cpf, setCpf] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search, 300);

  const params = { search: q, status, period, inbox_id: inbox, vendeu, cpf, conflict: conflict ? 1 : undefined };
  const leads = useAsync(() => api.get<Paged<Lead>>(`/leads${qs({ ...params, page, page_size: 25 })}`), [q, status, period, inbox, vendeu, cpf, conflict, page]);
  const inboxes = useAsync(() => api.get<Inbox[]>('/inboxes'), []);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const data = leads.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const filtersActive = Boolean(status || period !== 'all' || inbox || vendeu || cpf || conflict || q);

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={data ? `${number(data.total)} ${data.total === 1 ? 'lead' : 'leads'}${filtersActive ? ' com os filtros atuais' : ''}` : 'Carregando…'}
        actions={
          <>
            {can(user, 'manager') && (
              <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = `/api/leads/export.csv${qs(params)}`)}>
                Exportar
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo lead</Button>
          </>
        }
      />

      {/* Filtros */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-label-3" />
          <Input
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
            placeholder="Buscar por nome, telefone, CPF ou e-mail"
            aria-label="Buscar leads"
            className="!h-11 rounded-[12px] !bg-surface pl-10 shadow-card !border-transparent"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={!status} onClick={() => resetPage(setStatus)('')}>Todos</Chip>
          {LEAD_STATUSES.map((s) => (
            <Chip key={s} active={status === s} onClick={() => resetPage(setStatus)(status === s ? '' : s)}>{STATUS_LABEL[s]}</Chip>
          ))}
          <Chip active={conflict} onClick={() => resetPage(setConflict)(!conflict)}>
            <AlertTriangle className="size-3.5" /> Conflito de CPF
          </Chip>
          <div className="ml-auto flex flex-wrap gap-2">
            <Select value={period} onChange={(e) => resetPage(setPeriod)(e.target.value as Period)} aria-label="Período" className="!h-8 !w-auto rounded-full !text-[13px]">
              {PERIOD_OPTIONS.map((p) => <option key={p} value={p}>{p === 'all' ? 'Qualquer data' : PERIOD_LABEL[p]}</option>)}
            </Select>
            <Select value={inbox} onChange={(e) => resetPage(setInbox)(e.target.value)} aria-label="Caixa" className="!h-8 !w-auto rounded-full !text-[13px]">
              <option value="">Todas as caixas</option>
              {inboxes.data?.map((i) => <option key={i.id} value={i.id}>{i.custom_name || i.name}</option>)}
            </Select>
            <Select value={cpf} onChange={(e) => resetPage(setCpf)(e.target.value)} aria-label="CPF" className="!h-8 !w-auto rounded-full !text-[13px]">
              <option value="">Com e sem CPF</option>
              <option value="com">Com CPF</option>
              <option value="sem">Sem CPF</option>
            </Select>
            <Select value={vendeu} onChange={(e) => resetPage(setVendeu)(e.target.value)} aria-label="Venda" className="!h-8 !w-auto rounded-full !text-[13px]">
              <option value="">Com e sem venda</option>
              <option value="sim">Vendeu</option>
              <option value="nao">Não vendeu</option>
            </Select>
          </div>
        </div>
      </div>

      {leads.error && <ErrorNote message={leads.error} onRetry={leads.reload} />}

      <Card bodyClass="!p-0">
        {!data ? (
          <div className="space-y-3 p-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : data.items.length === 0 ? (
          <Empty icon={<InboxIcon className="size-7" />} title={filtersActive ? 'Nenhum lead encontrado' : 'Nenhum lead ainda'}>
            {filtersActive ? 'Tente outros filtros ou limpe a busca.' : 'Os leads aparecem aqui assim que chegarem mensagens pelo Chatwoot.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-separator text-[12px] font-medium text-label-3">
                  <th className="py-3 pl-6 pr-3 font-medium">Contato</th>
                  <th className="px-3 font-medium">Caixa</th>
                  <th className="px-3 font-medium">Status</th>
                  <th className="px-3 font-medium">Dados</th>
                  <th className="px-3 text-right font-medium">Venda</th>
                  <th className="py-3 pl-3 pr-6 text-right font-medium">Entrada</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((l) => (
                  <tr key={l.id} onClick={() => setOpenId(l.id)} className="cursor-pointer border-b border-separator transition-colors last:border-0 hover:bg-fill-2">
                    <td className="py-3 pl-6 pr-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={l.contact_name} size={36} />
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-semibold">{l.contact_name}</div>
                          <div className="truncate text-[13px] text-label-2">{l.contact_phone ? phone(l.contact_phone) : l.contact_email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3">
                      <div className="text-[13px]">{l.inbox_name || l.channel}</div>
                      <div className="text-[12px] text-label-3">{l.channel}</div>
                    </td>
                    <td className="px-3"><StatusPill status={l.status} /></td>
                    <td className="px-3">
                      <div className="flex flex-wrap gap-1">
                        {l.cpf_conflict ? <Tag tone="orange">Conflito CPF</Tag> : l.cpf ? <Tag tone={l.cpf_valid ? 'green' : 'red'}>CPF</Tag> : null}
                        {l.birth_date && <Tag>Nasc.</Tag>}
                        {l.cnh && <Tag tone={l.cnh === 'SIM' ? 'accent' : 'neutral'}>CNH {l.cnh === 'SIM' ? 'sim' : 'não'}</Tag>}
                        {!l.cpf && !l.birth_date && !l.cnh && <span className="text-[13px] text-label-3">—</span>}
                      </div>
                    </td>
                    <td className="px-3 text-right text-[14px] tabular">
                      {l.vendeu ? <span className="font-semibold text-green">{money(l.valor_venda)}</span> : <span className="text-label-3">—</span>}
                    </td>
                    <td className="py-3 pl-3 pr-6 text-right text-[13px] text-label-2">{relative(l.entry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.page_size && (
          <div className="flex items-center justify-between border-t border-separator px-6 py-3 text-[13px] text-label-2">
            <span>Página {page} de {pages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="plain" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="size-4" />}>Anterior</Button>
              <Button size="sm" variant="plain" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima <ChevronRight className="size-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      {openId && <LeadSheet id={openId} onClose={() => setOpenId(null)} onChanged={leads.reload} />}
      {creating && (
        <NewLeadDialog
          inboxes={inboxes.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(l) => {
            setCreating(false);
            leads.reload();
            setOpenId(l.id);
          }}
        />
      )}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors',
        active ? 'bg-label text-bg' : 'bg-surface text-label-2 shadow-card hover:text-label',
      )}
    >
      {children}
    </button>
  );
}

function NewLeadDialog({ inboxes, onClose, onCreated }: { inboxes: Inbox[]; onClose: () => void; onCreated: (l: Lead) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ contact_name: '', contact_phone: '', contact_email: '', channel: 'WhatsApp' as Channel, inbox_id: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      const lead = await api.post<Lead>('/leads', { ...form, inbox_id: form.inbox_id ? Number(form.inbox_id) : undefined });
      toast('success', 'Lead criado.');
      onCreated(lead);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Novo lead"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.contact_name.trim() || !form.contact_phone.trim()}>Criar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nome"><Input value={form.contact_name} onChange={set('contact_name')} autoFocus /></Field>
        <Field label="Telefone"><Input value={form.contact_phone} onChange={set('contact_phone')} placeholder="+55 91 9…" inputMode="tel" /></Field>
        <Field label="E-mail (opcional)"><Input value={form.contact_email} onChange={set('contact_email')} type="email" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Canal">
            <Select value={form.channel} onChange={set('channel')}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Caixa">
            <Select value={form.inbox_id} onChange={set('inbox_id')}>
              <option value="">Nenhuma</option>
              {inboxes.map((i) => <option key={i.id} value={i.id}>{i.custom_name || i.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
