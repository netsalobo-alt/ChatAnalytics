import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, ScanSearch, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { can, useSession } from '../lib/session.tsx';
import { dateTime, money, phone, relative } from '../lib/format.ts';
import { Avatar, Button, Dialog, ErrorNote, Field, Input, Select, Sheet, Skeleton, StatusPill, Tag, Textarea, Toggle, useToast, cx } from '../components/ui.tsx';
import { LEAD_STATUSES, STATUS_LABEL, type LeadDetail, type LeadStatus } from '../../shared/types.ts';

type Form = {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  cpf: string;
  birth_date: string;
  cnh: '' | 'SIM' | 'NÃO';
  status: LeadStatus;
  vendedor: string;
  loja: string;
  vendeu: boolean;
  valor_venda: string;
  observacao: string;
  motivo_reprovacao: string;
  veiculo: string;
  criativo: string;
};

const toForm = (l: LeadDetail): Form => ({
  contact_name: l.contact_name,
  contact_phone: l.contact_phone,
  contact_email: l.contact_email,
  cpf: l.cpf ?? '',
  birth_date: l.birth_date ?? '',
  cnh: l.cnh ?? '',
  status: l.status,
  vendedor: l.vendedor ?? '',
  loja: l.loja ?? '',
  vendeu: l.vendeu,
  valor_venda: l.valor_venda ? String(l.valor_venda).replace('.', ',') : '',
  observacao: l.observacao ?? '',
  motivo_reprovacao: l.motivo_reprovacao ?? '',
  veiculo: l.veiculo ?? '',
  criativo: l.criativo ?? '',
});

const parseMoney = (s: string) => {
  const n = Number(s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};

export default function LeadSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const lead = useAsync(() => api.get<LeadDetail>(`/leads/${encodeURIComponent(id)}`), [id]);
  const facets = useAsync(() => api.get<{ veiculos: string[]; criativos: string[] }>('/leads/facets'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [ask, setAsk] = useState<'approve' | 'reject' | 'delete' | null>(null);

  useEffect(() => {
    if (lead.data) setForm(toForm(lead.data));
  }, [lead.data]);

  const l = lead.data;
  const dirty = Boolean(l && form && JSON.stringify(toForm(l)) !== JSON.stringify(form));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const patch = async (body: Record<string, unknown>, message: string) => {
    if (!l) return;
    setSaving(true);
    try {
      const r = await api.patch<{ lead: LeadDetail; warning?: string }>(`/leads/${encodeURIComponent(l.id)}`, body);
      lead.setData(r.lead);
      toast(r.warning ? 'error' : 'success', r.warning ?? message);
      onChanged();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!l || !form) return;
    const original = toForm(l);
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(form) as (keyof Form)[]) {
      if (form[k] === original[k]) continue;
      if (k === 'valor_venda') body[k] = parseMoney(form.valor_venda);
      else if (k === 'cnh') body[k] = form.cnh || null;
      else body[k] = form[k];
    }
    patch(body, 'Alterações salvas.');
  };

  const rescan = async () => {
    if (!l) return;
    setScanning(true);
    try {
      const r = await api.post<{ lead: LeadDetail; found: string[] }>(`/leads/${encodeURIComponent(l.id)}/rescan`);
      lead.setData(r.lead);
      toast('success', r.found.length ? `${r.found.join(', ')} encontrado.` : 'Nenhum dado novo nas mensagens.');
      onChanged();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const remove = async () => {
    if (!l) return;
    try {
      await api.del(`/leads/${encodeURIComponent(l.id)}`);
      toast('success', 'Lead excluído.');
      onChanged();
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  const origin = (f: 'cpf' | 'birth_date' | 'cnh') =>
    l?.field_origins[f] === 'MANUAL' ? <Tag>manual</Tag> : l?.field_origins[f] === 'LOCAL' ? <Tag tone="accent">automático</Tag> : null;

  return (
    <Sheet
      title={l ? l.contact_name : 'Lead'}
      onClose={onClose}
      width={560}
      footer={
        form && (
          <>
            {can(user, 'manager') && (
              <Button variant="plain" className="mr-auto !text-red" icon={<Trash2 className="size-4" />} onClick={() => setAsk('delete')}>Excluir</Button>
            )}
            <Button onClick={() => l && setForm(toForm(l))} disabled={!dirty || saving}>Descartar</Button>
            <Button variant="primary" onClick={save} disabled={!dirty} loading={saving}>Salvar</Button>
          </>
        )
      }
    >
      {lead.error && <ErrorNote message={lead.error} onRetry={lead.reload} />}
      {!l || !form ? (
        <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : (
        <div className="space-y-5">
          {/* Cabeçalho */}
          <div className="flex items-center gap-4 rounded-[18px] bg-surface p-4 shadow-card">
            <Avatar name={l.contact_name} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><StatusPill status={l.status} />{l.vendeu && <Tag tone="green">Venda {money(l.valor_venda)}</Tag>}</div>
              <div className="mt-1 text-[13px] text-label-2">
                {l.inbox_name || l.channel} · entrou {relative(l.entry_date)} · última mensagem {relative(l.last_interaction_at)}
              </div>
            </div>
            {l.chatwoot_url && (
              <a href={l.chatwoot_url} target="_blank" rel="noreferrer" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-accent hover:brightness-95" title="Abrir no Chatwoot" aria-label="Abrir conversa no Chatwoot">
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>

          {/* Ações rápidas */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <QuickAction tone="green" active={l.status === 'APROVADO'} onClick={() => setAsk('approve')} disabled={saving}><Check className="size-4" />Aprovar</QuickAction>
            <QuickAction tone="red" active={l.status === 'REPROVADO'} onClick={() => setAsk('reject')} disabled={saving}><X className="size-4" />Reprovar</QuickAction>
            <QuickAction tone="indigo" active={l.status === 'EM_ANALISE'} onClick={() => patch({ status: 'EM_ANALISE' }, 'Lead em análise.')} disabled={saving}>Em análise</QuickAction>
            <QuickAction tone="orange" active={l.status === 'PENDENTE'} onClick={() => patch({ status: 'PENDENTE' }, 'Lead pendente.')} disabled={saving}>Pendente</QuickAction>
          </div>

          {l.cpf_conflict && (
            <div className="flex gap-3 rounded-2xl bg-orange-soft p-4 text-[14px] text-orange">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <div className="font-semibold">Conflito de CPF</div>
                <div className="mt-0.5">{l.cpf_conflict} Corrija o CPF abaixo para resolver.</div>
              </div>
            </div>
          )}

          <Section title="Contato">
            <Field label="Nome"><Input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telefone" hint={form.contact_phone ? phone(form.contact_phone) : undefined}><Input value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} inputMode="tel" /></Field>
              <Field label="E-mail"><Input value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} type="email" /></Field>
            </div>
          </Section>

          <Section title="Interesse">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Veículo de interesse">
                <Input value={form.veiculo} onChange={(e) => set('veiculo', e.target.value)} placeholder="Ex.: Onix LT 2022" list="opt-veiculos" />
              </Field>
              <Field label="Criativo / anúncio" hint={l.ad_id ? "Preenchido pelo anúncio. Se editar, vale o que você digitar." : "Preenchido sozinho quando o cliente vem de anúncio."}>
                <Input value={form.criativo} onChange={(e) => set('criativo', e.target.value)} placeholder="Ex.: Reels Onix Black Friday" list="opt-criativos" />
              </Field>
            </div>
            {l.ad_id && (
              <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2.5 ring-1 ring-separator">
                {l.ad_image ? (
                  <img src={l.ad_image} alt="" className="size-14 shrink-0 rounded-lg object-cover" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-label-2">
                    <Tag tone="accent">Anúncio {l.ad_platform ?? ''}</Tag>
                    <span className="truncate text-label-3">ID {l.ad_id}</span>
                  </div>
                  {l.ad_description && <p className="mt-1 line-clamp-2 text-[13px]" title={l.ad_description}>{l.ad_description}</p>}
                </div>
                {l.ad_link && (
                  <a href={l.ad_link} target="_blank" rel="noreferrer" className="shrink-0 text-accent" title="Ver anúncio" aria-label="Ver anúncio">
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
            )}
            <datalist id="opt-veiculos">{facets.data?.veiculos.map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="opt-criativos">{facets.data?.criativos.map((v) => <option key={v} value={v} />)}</datalist>
          </Section>

          <Section
            title="Qualificação"
            action={l.conversation_id ? <Button size="sm" variant="plain" loading={scanning} icon={<ScanSearch className="size-4" />} onClick={rescan}>Buscar nas mensagens</Button> : null}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={<span className="flex items-center gap-1.5">CPF {origin('cpf')}</span>} error={l.cpf && !l.cpf_valid && form.cpf === (l.cpf ?? '') ? 'CPF inválido' : null}>
                <Input value={form.cpf} onChange={(e) => set('cpf', e.target.value)} placeholder="000.000.000-00" inputMode="numeric" />
              </Field>
              <Field label={<span className="flex items-center gap-1.5">Nascimento {origin('birth_date')}</span>}>
                <Input value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} placeholder="DD/MM/AAAA" inputMode="numeric" />
              </Field>
              <Field label={<span className="flex items-center gap-1.5">CNH {origin('cnh')}</span>}>
                <Select value={form.cnh} onChange={(e) => set('cnh', e.target.value as Form['cnh'])}>
                  <option value="">Não informado</option>
                  <option value="SIM">Possui</option>
                  <option value="NÃO">Não possui</option>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => set('status', e.target.value as LeadStatus)}>
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field label="Vendedor"><Input value={form.vendedor} onChange={(e) => set('vendedor', e.target.value)} /></Field>
              <Field label="Loja"><Input value={form.loja} onChange={(e) => set('loja', e.target.value)} /></Field>
            </div>
            {form.status === 'REPROVADO' && (
              <Field label="Motivo da reprovação"><Input value={form.motivo_reprovacao} onChange={(e) => set('motivo_reprovacao', e.target.value)} /></Field>
            )}
          </Section>

          <Section title="Venda">
            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
              <span className="text-[15px]">Vendeu</span>
              <Toggle label="Vendeu" checked={form.vendeu} onChange={(v) => set('vendeu', v)} />
            </div>
            {form.vendeu && (
              <Field label="Valor da venda (R$)" hint={l.sale_date ? `Registrada em ${dateTime(l.sale_date)}` : undefined}>
                <Input value={form.valor_venda} onChange={(e) => set('valor_venda', e.target.value)} placeholder="0,00" inputMode="decimal" />
              </Field>
            )}
            <Field label="Observação"><Textarea value={form.observacao} onChange={(e) => set('observacao', e.target.value)} /></Field>
          </Section>

          {(l.recent_messages.length > 0 || l.tags.length > 0) && (
            <Section title="Mensagens do cliente">
              {l.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{l.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>}
              <div className="space-y-2">
                {l.recent_messages.slice(-8).map((m, i) => (
                  <div key={`${m.message_id ?? i}`} className="max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-fill px-3.5 py-2">
                    <p className="whitespace-pre-wrap break-words text-[14px]">{m.text}</p>
                    <span className="mt-0.5 block text-[11px] text-label-3">{dateTime(new Date(m.timestamp).toISOString())}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {ask === 'approve' && l && <ApproveDialog lead={l} onClose={() => setAsk(null)} onConfirm={(valor) => { setAsk(null); patch({ status: 'APROVADO', vendeu: true, valor_venda: valor }, 'Lead aprovado e venda registrada.'); }} />}
      {ask === 'reject' && l && <RejectDialog onClose={() => setAsk(null)} onConfirm={(motivo) => { setAsk(null); patch({ status: 'REPROVADO', motivo_reprovacao: motivo }, 'Lead reprovado.'); }} />}
      {ask === 'delete' && (
        <Dialog title="Excluir lead?" onClose={() => setAsk(null)} footer={<><Button onClick={() => setAsk(null)}>Cancelar</Button><Button variant="destructive" onClick={remove}>Excluir</Button></>}>
          <p className="text-[15px] text-label-2">O lead sai dos relatórios. Se o cliente mandar nova mensagem no Chatwoot, ele volta como lead novo.</p>
        </Dialog>
      )}
    </Sheet>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-label-3">{title}</h3>
        {action}
      </div>
      <div className="space-y-3 rounded-[18px] bg-surface p-4 shadow-card">{children}</div>
    </section>
  );
}

function QuickAction({ tone, active, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone: 'green' | 'red' | 'indigo' | 'orange'; active: boolean }) {
  const tones = {
    green: active ? 'bg-green-fill text-white' : 'text-green',
    red: active ? 'bg-red-fill text-white' : 'text-red',
    indigo: active ? 'bg-indigo-fill text-white' : 'text-indigo',
    orange: active ? 'bg-orange-fill text-white' : 'text-orange',
  };
  return (
    <button {...rest} className={cx('inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-[14px] font-semibold shadow-card transition disabled:opacity-50', active ? '' : 'bg-surface hover:bg-surface-2', tones[tone])}>
      {children}
    </button>
  );
}

export function ApproveDialog({ lead, onClose, onConfirm }: { lead: { valor_venda: number }; onClose: () => void; onConfirm: (valor: number) => void }) {
  const [valor, setValor] = useState(lead.valor_venda ? String(lead.valor_venda).replace('.', ',') : '');
  return (
    <Dialog title="Aprovar lead" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => onConfirm(parseMoney(valor))}>Aprovar</Button></>}>
      <p className="mb-4 text-[15px] text-label-2">A aprovação registra a venda e aplica as etiquetas configuradas na conversa do Chatwoot.</p>
      <Field label="Valor da venda (R$)"><Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" autoFocus /></Field>
    </Dialog>
  );
}

export function RejectDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('');
  const reasons = ['Score baixo', 'Sem entrada', 'Documentação incompleta', 'Desistiu', 'Sem contato'];
  return (
    <Dialog title="Reprovar lead" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="destructive" onClick={() => onConfirm(motivo.trim() || 'Não informado')}>Reprovar</Button></>}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button key={r} onClick={() => setMotivo(r)} className={cx('rounded-full px-3 py-1 text-[13px] font-medium', motivo === r ? 'bg-label text-bg' : 'bg-fill text-label-2')}>{r}</button>
        ))}
      </div>
      <Field label="Motivo"><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Field>
    </Dialog>
  );
}
