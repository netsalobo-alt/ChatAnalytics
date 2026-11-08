import { useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Button, Input } from '../components/ui.tsx';
import type { User } from '../../shared/types.ts';

export default function Login({ setup, onDone }: { setup: boolean; onDone: (u: User) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = setup
        ? await api.post<{ user: User }>('/auth/setup', { name, email, password })
        : await api.post<{ user: User }>('/auth/login', { email, password });
      onDone(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-12">
      {/* Brilho de fundo sutil */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] blur-2xl" />
      <div className="animate-fade-up relative w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icon.svg" alt="" className="mb-5 size-16 rounded-[18px] shadow-[0_10px_30px_rgba(0,113,227,0.3)]" />
          <h1 className="display text-[28px] font-bold">{setup ? 'Bem-vindo ao ChatAnalytics' : 'Entrar no ChatAnalytics'}</h1>
          <p className="mt-2 text-[15px] text-label-2">
            {setup ? 'Crie a conta de administrador para começar.' : 'Use seu e-mail e senha da equipe.'}
          </p>
        </div>

        <form onSubmit={submit} className="rounded-[22px] bg-surface p-6 shadow-card">
          <div className="space-y-3">
            {setup && (
              <Input aria-label="Nome" placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
            )}
            <Input aria-label="E-mail" type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={!setup} />
            <Input
              aria-label="Senha"
              type="password"
              placeholder={setup ? 'Senha (mínimo 8 caracteres)' : 'Senha'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={setup ? 'new-password' : 'current-password'}
              minLength={setup ? 8 : undefined}
              required
            />
          </div>
          {error && <p role="alert" className="mt-3 text-[13px] text-red">{error}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
            {setup ? 'Criar conta' : 'Entrar'} {!busy && <ArrowRight className="size-4" />}
          </Button>
        </form>
        <p className="mt-6 text-center text-[12px] text-label-3">
          {setup ? 'Os próximos usuários serão convidados por você.' : 'Esqueceu a senha? Peça a um administrador para redefinir.'}
        </p>
      </div>
    </div>
  );
}
