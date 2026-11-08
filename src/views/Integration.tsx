import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, DownloadCloud, KeyRound, RefreshCw, Tag as TagIcon, UploadCloud, Webhook } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';
import { useLive } from '../lib/live.ts';
import { can, useSession } from '../lib/session.tsx';
import { dateTime, relative } from '../lib/format.ts';
import { Button, Card, Dialog, ErrorNote, Segmented, Field, Input, PageHeader, Select, Skeleton, Tag, Toggle, useToast, cx } from '../components/ui.tsx';
import type { ChatwootSettings, WebhookLog } from '../../shared/types.ts';

export default function Integration() {
  const { user } = useSession();
  const admin = can(user, 'admin');
  const toast = useToast();
  const settings = useAsync(() => api.get<ChatwootSettings>('/settings'), []);
  const logs = useAsync(() => api.get<WebhookLog[]>('/webhook-logs'), []);
  const [form, setForm] = useState({ chatwoot_url: '', account_id: '', api_token: '', labels_on_approve: '', labels_on_reject: '' });
  const [busy, setBusy] = useState<'save' | 'test' | 'sync' | 'full' | null>(null);
  const s = settings.data;
  useLive(['webhook', 'sync'], () => {
    logs.reload();
    settings.reload();
  }, 400);

  useEffect(() => {
    if (s) setForm({ chatwoot_url: s.chatwoot_url, account_id: s.account_id, api_token: '', labels_on_approve: s.labels_on_approve, labels_on_reject: s.labels_on_reject });
  }, [s]);

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>, ok: (r: T) => string) => {
    setBusy(kind);
    try {
      const r = await fn();
      toast('success', ok(r));
      return r;
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', () => api.put<ChatwootSettings>('/settings', form), () => 'Integração salva.').then((r) => r && settings.setData(r));
  const test = () => run('test', () => api.post<{ inboxes: number }>('/settings/test', form), (r) => `Conexão OK · ${r.inboxes} caixas encontradas.`);
  const sync = (full: boolean) =>
    run(full ? 'full' : 'sync', () => api.post<{ message: string }>('/sync', { full }), (r) => r.message).then(() => {
      settings.reload();
      logs.reload();
    });
  const setAuto = (body: Partial<ChatwootSettings>) =>
    api.put<ChatwootSettings>('/settings', body).then(settings.setData).catch((err) => toast('error', err.message));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'URL copiada.');
    } catch {
      toast('error', 'Não foi possível copiar. Selecione e copie manualmente.');
    }
  };

  const connected = Boolean(s?.has_token && s.chatwoot_url && s.account_id);

  return (
    <>
      <PageHeader title="Integração" subtitle="Conexão com o Chatwoot, webhook em tempo real e sincronização." />
      {settings.error && <ErrorNote message={settings.error} onRetry={settings.reload} />}
      {!s ? (
        <Skeleton className="h-80 rounded-[20px]" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="space-y-4 xl:col-span-3">
            <Card
              title="Chatwoot"
              subtitle={connected ? 'Conectado' : 'Informe os dados de acesso da sua conta'}
              action={connected ? <span className="flex items-center gap-1.5 text-[13px] font-medium text-green"><CheckCircle2 className="size-4" />Conectado</span> : null}
            >
              <div className="space-y-3">
                <Field label="Endereço do Chatwoot"><Input value={form.chatwoot_url} onChange={(e) => setForm({ ...form, chatwoot_url: e.target.value })} placeholder="https://conversa.suaempresa.com.br" disabled={!admin} /></Field>
                <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                  <Field label="Account ID"><Input value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} inputMode="numeric" disabled={!admin} /></Field>
                  <Field label="Token de acesso" hint={s.has_token ? `Salvo (${s.token_hint}). Deixe em branco para manter.` : 'Perfil do Chatwoot › Token de acesso.'}>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-label-3" />
                      <Input type="password" value={form.api_token} onChange={(e) => setForm({ ...form, api_token: e.target.value })} placeholder={s.has_token ? '••••••••' : 'Cole o token'} className="pl-9" autoComplete="off" disabled={!admin} />
                    </div>
                  </Field>
                </div>
                {admin && (
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <Button onClick={test} loading={busy === 'test'}>Testar conexão</Button>
                    <Button variant="primary" onClick={save} loading={busy === 'save'}>Salvar</Button>
                  </div>
                )}
              </div>
            </Card>

            <Card title="Webhook em tempo real" subtitle="Configurações do Chatwoot › Integrações › Webhooks › Adicionar">
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-1.5 pl-3 ring-1 ring-separator">
                <Webhook className="size-4 shrink-0 text-label-3" />
                <code className="min-w-0 flex-1 truncate text-[13px]">{s.webhook_url}</code>
                <Button size="sm" variant="tinted" icon={<Copy className="size-3.5" />} onClick={() => copy(s.webhook_url)}>Copiar</Button>
              </div>
              <p className="mt-3 text-[13px] text-label-2">
                Marque os eventos <b>Mensagem criada</b>, <b>Conversa criada</b> e <b>Conversa atualizada</b>. A URL contém um código secreto: não compartilhe.
              </p>
            </Card>

            <Card title="Etiquetas no Chatwoot" subtitle="Aplicadas na conversa ao aprovar ou reprovar um lead. As demais etiquetas são mantidas.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ao aprovar"><Input value={form.labels_on_approve} onChange={(e) => setForm({ ...form, labels_on_approve: e.target.value })} placeholder="Aprovado, Ganhamos" disabled={!admin} /></Field>
                <Field label="Ao reprovar"><Input value={form.labels_on_reject} onChange={(e) => setForm({ ...form, labels_on_reject: e.target.value })} placeholder="Reprovado" disabled={!admin} /></Field>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-label-3"><TagIcon className="size-3.5" />Separe por vírgula. Salve com o botão do cartão Chatwoot.</p>
            </Card>
          </div>

          <div className="space-y-4 xl:col-span-2">
            <Card title="Sincronização">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[15px]">Automática</div>
                    <div className="text-[13px] text-label-3">Busca conversas novas periodicamente</div>
                  </div>
                  <Toggle label="Sincronização automática" checked={s.auto_sync_enabled} disabled={!admin} onChange={(v) => setAuto({ auto_sync_enabled: v })} />
                </div>
                {s.auto_sync_enabled && (
                  <Field label="Intervalo">
                    <Select value={s.auto_sync_minutes} onChange={(e) => setAuto({ auto_sync_minutes: Number(e.target.value) })} disabled={!admin}>
                      {[5, 10, 15, 30, 60, 180].map((m) => <option key={m} value={m}>{m < 60 ? `A cada ${m} minutos` : `A cada ${m / 60} h`}</option>)}
                    </Select>
                  </Field>
                )}
                <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-label-2">Última sincronização</span>
                    <span className={cx('font-medium', s.last_sync_status === 'error' ? 'text-red' : s.last_sync_status === 'success' ? 'text-green' : 'text-label-2')}>
                      {s.last_sync_status === 'syncing' ? 'Em andamento…' : s.last_sync_at ? relative(s.last_sync_at) : 'Nunca'}
                    </span>
                  </div>
                  {s.last_sync_message && <div className="mt-1 text-label-3">{s.last_sync_message}</div>}
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" icon={<RefreshCw className="size-4" />} onClick={() => sync(false)} loading={busy === 'sync'} disabled={!connected || busy !== null}>Sincronizar agora</Button>
                  <Button variant="plain" onClick={() => sync(true)} loading={busy === 'full'} disabled={!connected || busy !== null} title="Relê todo o histórico de conversas">Histórico completo</Button>
                </div>
              </div>
            </Card>

            <WebhookLogCard logs={logs.data} onReload={logs.reload} />

            {admin && <BackupCard onImported={() => { settings.reload(); }} />}
          </div>
        </div>
      )}
    </>
  );
}

interface ImportResult {
  format: 'v3' | 'legacy';
  leads: number;
  investments: number;
  inboxes: number;
  skipped: number;
}

function BackupCard({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown; leads: number; legacy: boolean } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const legacy = !(data?.system === 'ChatAnalytics' && data?.version === 3);
      const leads = Array.isArray(data?.leads) ? data.leads.length : data?.leads ? Object.keys(data.leads).length : 0;
      if (!data?.leads) throw new Error('O arquivo não parece um backup do ChatAnalytics.');
      setMode('merge');
      setPending({ name: file.name, data, leads, legacy });
    } catch (err) {
      toast('error', err instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : (err as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api.post<ImportResult>('/backup/import', { data: pending.data, mode });
      toast('success', `${r.leads} leads, ${r.investments} investimentos e ${r.inboxes} caixas importados.`);
      setPending(null);
      onImported();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Backup e migração" subtitle="Cópia completa de leads, investimentos, caixas e configuração. Usuários não entram no arquivo.">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button icon={<DownloadCloud className="size-4" />} onClick={() => (window.location.href = '/api/backup')}>Baixar backup</Button>
        <Button icon={<UploadCloud className="size-4" />} onClick={() => fileRef.current?.click()}>Importar arquivo</Button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <p className="mt-3 text-[12px] text-label-3">
        Aceita backups desta versão e do ChatAnalytics 2.0 (inclusive o arquivo chatanalytics_db.json). O backup contém o token do Chatwoot e dados pessoais: guarde em local seguro.
      </p>

      {pending && (
        <Dialog
          title="Importar backup"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)}>Cancelar</Button>
              <Button variant={mode === 'replace' ? 'destructive' : 'primary'} onClick={run} loading={busy}>
                {mode === 'replace' ? 'Substituir tudo' : 'Importar'}
              </Button>
            </>
          }
        >
          <p className="text-[15px] text-label-2">
            <b className="text-label">{pending.name}</b> · {pending.leads} leads{pending.legacy ? ' · formato do ChatAnalytics 2.0' : ''}
          </p>
          <Segmented
            className="mt-4"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: 'Mesclar' },
              { value: 'replace', label: 'Substituir' },
            ]}
          />
          <p className={cx('mt-3 text-[13px]', mode === 'replace' ? 'text-red' : 'text-label-2')}>
            {mode === 'merge'
              ? 'Atualiza os leads com o mesmo identificador e acrescenta os novos. Nada é apagado.'
              : 'Apaga todos os leads, investimentos e caixas atuais antes de importar. Não dá para desfazer.'}
          </p>
        </Dialog>
      )}
    </Card>
  );
}

const EVENT_LABEL: Record<string, string> = {
  message_created: 'Mensagem criada',
  message_updated: 'Mensagem atualizada',
  conversation_created: 'Conversa criada',
  conversation_updated: 'Conversa atualizada',
  conversation_status_changed: 'Status da conversa',
  conversation_opened: 'Conversa aberta',
};

function webhookHealth(logs: WebhookLog[]) {
  const last = logs[0];
  if (!last) return { tone: 'gray', title: 'Nenhum evento recebido', text: 'Cadastre a URL acima no Chatwoot (Configurações › Integrações › Webhooks).' };
  const mins = (Date.now() - new Date(last.received_at).getTime()) / 60_000;
  if (last.status === 'error') return { tone: 'red', title: 'Último evento com erro', text: last.summary };
  if (mins <= 30) return { tone: 'green', title: 'Webhook funcionando', text: `Último evento ${relative(last.received_at)}.` };
  if (mins <= 24 * 60) return { tone: 'orange', title: `Sem eventos ${relative(last.received_at)}`, text: 'Normal fora do horário de atendimento. Se houver conversas novas no Chatwoot, confira o webhook.' };
  return { tone: 'red', title: `Sem eventos ${relative(last.received_at)}`, text: 'O Chatwoot pode ter parado de enviar. Confira o webhook no Chatwoot.' };
}

function WebhookLogCard({ logs, onReload }: { logs: WebhookLog[] | null; onReload: () => void }) {
  // Atualiza os tempos relativos ("há 2 min") sem precisar recarregar.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const health = logs ? webhookHealth(logs) : null;
  const tones: Record<string, { dot: string; bg: string; text: string }> = {
    green: { dot: 'bg-green-fill', bg: 'bg-green-soft', text: 'text-green' },
    orange: { dot: 'bg-orange-fill', bg: 'bg-orange-soft', text: 'text-orange' },
    red: { dot: 'bg-red-fill', bg: 'bg-red-soft', text: 'text-red' },
    gray: { dot: 'bg-label-3', bg: 'bg-fill-2', text: 'text-label-2' },
  };
  const t = health ? tones[health.tone] : tones.gray;

  return (
    <Card
      title="Log do webhook"
      subtitle="Últimos 5 eventos recebidos do Chatwoot. Os mais antigos são descartados."
      action={<Button size="sm" variant="plain" onClick={onReload}>Atualizar</Button>}
      bodyClass="!px-0 !pb-2"
    >
      {!logs || !health ? (
        <div className="px-6"><Skeleton className="h-32" /></div>
      ) : (
        <>
          <div className={cx('mx-6 mb-3 flex gap-3 rounded-xl p-3', t.bg)}>
            <span className="relative mt-1.5 flex size-2.5 shrink-0">
              {health.tone === 'green' && <span className={cx('absolute inline-flex size-full animate-ping rounded-full opacity-60', t.dot)} />}
              <span className={cx('relative inline-flex size-2.5 rounded-full', t.dot)} />
            </span>
            <div className="min-w-0">
              <div className={cx('text-[14px] font-semibold', t.text)}>{health.title}</div>
              <div className="text-[12px] text-label-2">{health.text}</div>
            </div>
          </div>
          {logs.length > 0 && (
            <ul>
              {logs.map((l) => (
                <li key={l.id} className="animate-fade-up border-t border-separator px-6 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium">
                      {EVENT_LABEL[l.event] ?? l.event}
                      {l.contact_name && <span className="font-normal text-label-2"> · {l.contact_name}</span>}
                    </span>
                    <Tag tone={l.status === 'processed' ? 'green' : l.status === 'error' ? 'red' : 'neutral'}>
                      {l.status === 'processed' ? 'processado' : l.status === 'error' ? 'erro' : 'ignorado'}
                    </Tag>
                  </div>
                  <div className="mt-0.5 flex justify-between gap-2 text-[12px] text-label-3">
                    <span className="truncate" title={l.summary}>{l.summary}</span>
                    <span className="shrink-0" title={dateTime(l.received_at)}>{relative(l.received_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
