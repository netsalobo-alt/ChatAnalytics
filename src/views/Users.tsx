import { useState } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useSession } from '../lib/session.tsx';
import { relative } from '../lib/format.ts';
import { Avatar, Button, Card, Dialog, ErrorNote, Field, IconButton, Input, PageHeader, Select, Skeleton, Tag, Toggle, useToast } from '../components/ui.tsx';
import { ROLE_LABEL, type Role, type User } from '../../shared/types.ts';

const ROLE_HELP: Record<Role, string> = {
  admin: 'Tudo, incluindo usuários e integração.',
  manager: 'Leads, canais, investimentos, exportação e sincronização.',
  operator: 'Consulta o painel e qualifica leads.',
};

export default function UsersView() {
  const { user: me } = useSession();
  const toast = useToast();
  const users = useAsync(() => api.get<User[]>('/users'), []);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

  const update = async (u: User, body: Partial<User>, message: string) => {
    try {
      const next = await api.patch<User>(`/users/${u.id}`, body);
      users.setData((l) => l?.map((x) => (x.id === u.id ? next : x)) ?? null);
      toast('success', message);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Quem acessa o ChatAnalytics e o que cada pessoa pode fazer."
        actions={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>Convidar</Button>}
      />
      {users.error && <ErrorNote message={users.error} onRetry={users.reload} />}
      <Card bodyClass="!p-0">
        {!users.data ? (
          <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : (
          <ul>
            {users.data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-4 border-t border-separator px-6 py-4 first:border-0">
                <Avatar name={u.name} size={40} />
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2 text-[15px] font-semibold">
                    {u.name} {u.id === me.id && <Tag>você</Tag>} {!u.active && <Tag tone="red">desativado</Tag>}
                  </div>
                  <div className="text-[13px] text-label-2">{u.email} · último acesso {relative(u.last_login_at)}</div>
                </div>
                <Select
                  value={u.role}
                  onChange={(e) => update(u, { role: e.target.value as Role }, 'Perfil atualizado.')}
                  className="!h-9 !w-[150px] rounded-full !text-[13px]"
                  aria-label={`Perfil de ${u.name}`}
                >
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
                <IconButton label="Redefinir senha" onClick={() => setResetting(u)}><KeyRound className="size-4" /></IconButton>
                <Toggle
                  label={u.active ? 'Desativar acesso' : 'Reativar acesso'}
                  checked={u.active}
                  disabled={u.id === me.id}
                  onChange={(v) => update(u, { active: v }, v ? 'Acesso reativado.' : 'Acesso desativado.')}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
          <div key={r} className="rounded-2xl bg-fill-2 p-4">
            <div className="text-[14px] font-semibold">{ROLE_LABEL[r]}</div>
            <div className="mt-1 text-[13px] text-label-2">{ROLE_HELP[r]}</div>
          </div>
        ))}
      </div>

      {creating && <InviteDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); users.reload(); }} />}
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

function InviteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'operator' as Role });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/users', f);
      toast('success', `${f.name} pode entrar com o e-mail e a senha definidos.`);
      onCreated();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Convidar usuário" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} loading={busy} disabled={!f.name || !f.email || f.password.length < 8}>Criar acesso</Button></>}>
      <div className="space-y-3">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Senha inicial" hint="Mínimo de 8 caracteres. Compartilhe por um canal seguro."><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Perfil" hint={ROLE_HELP[f.role]}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/users/${user.id}`, { password });
      toast('success', 'Senha redefinida. As sessões abertas foram encerradas.');
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Nova senha para ${user.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} loading={busy} disabled={password.length < 8}>Redefinir</Button></>}>
      <Field label="Nova senha" hint="Mínimo de 8 caracteres."><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" /></Field>
    </Dialog>
  );
}
