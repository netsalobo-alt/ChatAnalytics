import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Lock, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useLive } from '../lib/live.ts';
import { number } from '../lib/format.ts';
import { STATUS_COLOR_NAME, statusFill, statusPillStyle, useStatuses } from '../lib/statuses.tsx';
import { Button, Card, Dialog, ErrorNote, Field, IconButton, Input, PageHeader, Select, Skeleton, cx, useToast } from '../components/ui.tsx';
import { STATUS_COLORS, STATUS_KIND_LABEL, type StatusColor, type StatusDef, type StatusKind } from '../../shared/types.ts';

const KIND_HELP: Record<StatusKind, string> = {
  new: 'Onde todo lead novo começa.',
  open: 'Lead em andamento, sem efeito na venda.',
  won: 'Registra a venda: pede o valor e aplica as etiquetas de aprovação no Chatwoot.',
  lost: 'Lead perdido: pede o motivo e aplica as etiquetas de reprovação no Chatwoot.',
};

export default function Settings() {
  const toast = useToast();
  const { reload: reloadShared } = useStatuses();
  const data = useAsync(() => api.get<StatusDef[]>('/statuses?counts=1'), []);
  useLive(['statuses', 'sync'], data.reload, 300);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<StatusDef | null>(null);

  const list = data.data ?? [];

  const save = async (st: StatusDef, body: Partial<StatusDef>) => {
    try {
      const r = await api.patch<StatusDef>(`/statuses/${st.key}`, body);
      data.setData((l) => l?.map((x) => (x.key === st.key ? { ...r, leads: x.leads } : x)) ?? null);
      reloadShared();
      return true;
    } catch (err) {
      toast('error', (err as Error).message);
      return false;
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const keys = list.map((s) => s.key);
    const j = index + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[index], keys[j]] = [keys[j], keys[index]];
    data.setData((l) => (l ? keys.map((k) => l.find((s) => s.key === k)!) : l));
    try {
      data.setData(await api.put<StatusDef[]>('/statuses/order', { keys }));
      reloadShared();
    } catch (err) {
      toast('error', (err as Error).message);
      data.reload();
    }
  };

  return (
    <>
      <PageHeader title="Configurações" subtitle="Ajustes do sistema para toda a equipe." />

      <Card
        title="Status dos leads"
        subtitle="Renomeie, mude a cor, reordene ou crie status. O tipo define o comportamento: ganho registra a venda, perdido pede o motivo."
        action={<Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Novo status</Button>}
        bodyClass="!px-0 !pb-2"
      >
        {data.error && <div className="px-6"><ErrorNote message={data.error} onRetry={data.reload} /></div>}
        {!data.data ? (
          <div className="space-y-2 px-6">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : (
          <ul>
            {list.map((st, i) => (
              <StatusRow
                key={st.key}
                status={st}
                first={i === 0}
                last={i === list.length - 1}
                onSave={(body) => save(st, body)}
                onMove={(dir) => move(i, dir)}
                onDelete={() => setRemoving(st)}
              />
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(KIND_HELP) as StatusKind[]).map((k) => (
          <div key={k} className="rounded-2xl bg-fill-2 p-4">
            <div className="text-[14px] font-semibold">{STATUS_KIND_LABEL[k]}</div>
            <div className="mt-1 text-[13px] text-label-2">{KIND_HELP[k]}</div>
          </div>
        ))}
      </div>

      {creating && (
        <NewStatusDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            data.reload();
            reloadShared();
          }}
        />
      )}
      {removing && (
        <DeleteStatusDialog
          status={removing}
          others={list.filter((s) => s.key !== removing.key)}
          onClose={() => setRemoving(null)}
          onDeleted={() => {
            setRemoving(null);
            data.reload();
            reloadShared();
          }}
        />
      )}
    </>
  );
}

function StatusRow({
  status, first, last, onSave, onMove, onDelete,
}: {
  status: StatusDef;
  first: boolean;
  last: boolean;
  onSave: (body: Partial<StatusDef>) => Promise<boolean>;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(status.label);
  const [saved, setSaved] = useState(false);
  useEffect(() => setLabel(status.label), [status.label]);

  const commit = async () => {
    const v = label.trim();
    if (!v || v === status.label) return setLabel(status.label);
    if (await onSave({ label: v })) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } else setLabel(status.label);
  };

  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-separator px-6 py-3 first:border-0">
      <ColorPicker value={status.color} onChange={(color) => onSave({ color })} />
      <div className="relative min-w-[180px] flex-1">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setLabel(status.label);
          }}
          maxLength={40}
          aria-label={`Nome do status ${status.label}`}
          className="!h-9 pr-8"
        />
        {saved && <Check className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-green" />}
      </div>
      <div className="hidden w-[160px] md:block">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={statusPillStyle(status.color)}>
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusFill(status.color) }} />
          <span className="truncate">{label.trim() || status.label}</span>
        </span>
      </div>
      <div className="w-[150px]">
        {status.system ? (
          <span className="flex items-center gap-1.5 text-[13px] text-label-2" title="O tipo dos status de fábrica é fixo">
            <Lock className="size-3.5 text-label-3" /> {STATUS_KIND_LABEL[status.kind]}
          </span>
        ) : (
          <Select value={status.kind} onChange={(e) => onSave({ kind: e.target.value as StatusKind })} className="!h-9 !text-[13px]" aria-label="Tipo do status">
            {(['open', 'won', 'lost'] as StatusKind[]).map((k) => <option key={k} value={k}>{STATUS_KIND_LABEL[k]}</option>)}
          </Select>
        )}
      </div>
      <span className="w-[72px] text-right text-[13px] text-label-3 tabular">{number(status.leads ?? 0)} leads</span>
      <div className="flex items-center">
        <IconButton label="Subir" disabled={first} onClick={() => onMove(-1)} className="disabled:opacity-30"><ArrowUp className="size-4" /></IconButton>
        <IconButton label="Descer" disabled={last} onClick={() => onMove(1)} className="disabled:opacity-30"><ArrowDown className="size-4" /></IconButton>
        <IconButton
          label={status.system ? 'Status de fábrica não pode ser excluído' : 'Excluir status'}
          disabled={status.system}
          onClick={onDelete}
          className="hover:!text-red disabled:opacity-30"
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

function ColorPicker({ value, onChange }: { value: StatusColor; onChange: (c: StatusColor) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Cor: ${STATUS_COLOR_NAME[value]}`}
        title="Mudar a cor"
        className="flex size-9 items-center justify-center rounded-full bg-fill-2 transition hover:bg-fill"
      >
        <span className="size-5 rounded-full ring-2 ring-white/70" style={{ background: statusFill(value) }} />
      </button>
      {open && (
        <div className="animate-pop absolute left-0 top-11 z-20 grid w-[208px] grid-cols-5 gap-2 rounded-2xl bg-elevated p-3 shadow-pop">
          {STATUS_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={STATUS_COLOR_NAME[c]}
              aria-label={STATUS_COLOR_NAME[c]}
              onClick={() => {
                setOpen(false);
                if (c !== value) onChange(c);
              }}
              className={cx('flex size-8 items-center justify-center rounded-full transition hover:scale-110', c === value && 'ring-2 ring-label ring-offset-2 ring-offset-[var(--elevated)]')}
              style={{ background: statusFill(c) }}
            >
              {c === value && <Check className="size-4 text-white" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewStatusDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<StatusKind>('open');
  const [color, setColor] = useState<StatusColor>('purple');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post('/statuses', { label, kind, color });
      toast('success', `Status "${label.trim()}" criado.`);
      onCreated();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Novo status"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} loading={busy} disabled={!label.trim()}>Criar</Button></>}
    >
      <div className="space-y-4">
        <Field label="Nome">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Aguardando documentos" maxLength={40} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && label.trim() && save()} />
        </Field>
        <Field label="Tipo" hint={KIND_HELP[kind]}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as StatusKind)}>
            {(['open', 'won', 'lost'] as StatusKind[]).map((k) => <option key={k} value={k}>{STATUS_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Cor">
          <div className="flex flex-wrap gap-2">
            {STATUS_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={STATUS_COLOR_NAME[c]}
                aria-label={STATUS_COLOR_NAME[c]}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={cx('flex size-8 items-center justify-center rounded-full transition hover:scale-110', c === color && 'ring-2 ring-label ring-offset-2 ring-offset-[var(--elevated)]')}
                style={{ background: statusFill(c) }}
              >
                {c === color && <Check className="size-4 text-white" />}
              </button>
            ))}
          </div>
        </Field>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-label-2">Prévia</span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={statusPillStyle(color)}>
            <span className="size-1.5 rounded-full" style={{ background: statusFill(color) }} />
            {label.trim() || 'Novo status'}
          </span>
        </div>
      </div>
    </Dialog>
  );
}

function DeleteStatusDialog({ status, others, onClose, onDeleted }: { status: StatusDef; others: StatusDef[]; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const [moveTo, setMoveTo] = useState(others[0]?.key ?? '');
  const [busy, setBusy] = useState(false);
  const inUse = (status.leads ?? 0) > 0;

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.del<{ moved: number }>(`/statuses/${status.key}${inUse ? `?move_to=${encodeURIComponent(moveTo)}` : ''}`);
      toast('success', r.moved ? `Status excluído. ${r.moved} lead(s) movidos.` : 'Status excluído.');
      onDeleted();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Excluir "${status.label}"?`}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="destructive" onClick={remove} loading={busy}>Excluir</Button></>}
    >
      {inUse ? (
        <Field label={`${number(status.leads ?? 0)} lead(s) estão neste status. Mover para:`}>
          <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {others.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </Field>
      ) : (
        <p className="text-[15px] text-label-2">Nenhum lead usa este status. Ele sai das listas e dos filtros.</p>
      )}
    </Dialog>
  );
}
