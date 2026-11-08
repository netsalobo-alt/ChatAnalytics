// Componentes de interface no estilo Apple: cartões, botões, controles segmentados, painéis e avisos.

import {
  createContext, useCallback, useContext, useEffect, useId, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { STATUS_LABEL, type LeadStatus } from '../../shared/types.ts';
import { initials } from '../lib/format.ts';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------- Superfícies ----------

export function Card({
  title, subtitle, action, children, className, bodyClass,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={cx('rounded-[var(--radius-card)] bg-surface shadow-card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-6 pt-5">
          <div className="min-w-0">
            {title && <h2 className="display text-[17px] font-semibold text-label">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-label-2">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cx('px-6 pb-6', title || action ? 'pt-4' : 'pt-6', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="display text-[28px] font-bold leading-tight text-label sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-label-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Botões ----------

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive' | 'tinted';

export function Button({
  variant = 'secondary', size = 'md', icon, loading, children, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-white hover:bg-accent-hover active:brightness-95',
    secondary: 'bg-fill text-label hover:bg-fill/80 active:bg-fill',
    tinted: 'bg-accent-soft text-accent hover:brightness-95',
    plain: 'text-accent hover:bg-fill-2',
    destructive: 'bg-red-soft text-red hover:brightness-95',
  };
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-9 px-4 text-[14px] gap-2', lg: 'h-11 px-5 text-[15px] gap-2' };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium transition-[background,filter,opacity] duration-150 disabled:opacity-45',
        styles[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx('inline-flex size-8 items-center justify-center rounded-full text-label-2 transition hover:bg-fill hover:text-label', className)}
    >
      {children}
    </button>
  );
}

// ---------- Controle segmentado ----------

export function Segmented<T extends string>({
  options, value, onChange, size = 'md', className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cx('inline-flex rounded-[10px] bg-fill p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'whitespace-nowrap rounded-[8px] font-medium transition-all duration-200',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]',
              active ? 'bg-elevated text-label shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]' : 'text-label-2 hover:text-label',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Selo de status / variação ----------

const STATUS_STYLE: Record<LeadStatus, { dot: string; text: string; bg: string }> = {
  NOVO: { dot: 'bg-accent', text: 'text-accent', bg: 'bg-accent-soft' },
  EM_ANALISE: { dot: 'bg-indigo-fill', text: 'text-indigo', bg: 'bg-indigo-soft' },
  PENDENTE: { dot: 'bg-orange-fill', text: 'text-orange', bg: 'bg-orange-soft' },
  APROVADO: { dot: 'bg-green-fill', text: 'text-green', bg: 'bg-green-soft' },
  REPROVADO: { dot: 'bg-red-fill', text: 'text-red', bg: 'bg-red-soft' },
};
export const statusColor = (s: LeadStatus) => STATUS_STYLE[s];

export function StatusPill({ status }: { status: LeadStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium', s.bg, s.text)}>
      <span className={cx('size-1.5 rounded-full', s.dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Change({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-[12px] font-medium text-label-3">novo</span>;
  if (!isFinite(value) || Math.abs(value) < 0.05) return <span className="text-[12px] font-medium text-label-3">estável</span>;
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-[12px] font-semibold tabular', good ? 'text-green' : 'text-red')}>
      <Icon className="size-3.5" strokeWidth={2.5} />
      {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'orange' | 'red' | 'green' }) {
  const tones = {
    neutral: 'bg-fill-2 text-label-2',
    accent: 'bg-accent-soft text-accent',
    orange: 'bg-orange-soft text-orange',
    red: 'bg-red-soft text-red',
    green: 'bg-green-soft text-green',
  };
  return <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>;
}

// ---------- Avatar ----------

const AVATAR_TONES = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30b0c7', '#34c759', '#ac8e68'];

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(180deg, ${color}cc, ${color})` }}
    >
      {initials(name)}
    </span>
  );
}

// ---------- Formulários ----------

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-label-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-red">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-label-3">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  'w-full rounded-[10px] border border-separator bg-surface-2 px-3 text-[15px] text-label placeholder:text-label-3 outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft disabled:opacity-60';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, 'h-10', props.className)} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputCls, 'h-10 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8', props.className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%2386868b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'min-h-[84px] resize-y py-2.5', props.className)} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50', checked ? 'bg-green-fill' : 'bg-[var(--toggle-off)]')}
    >
      <span className={cx('absolute left-0 top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200', checked ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
    </button>
  );
}

// ---------- Painéis ----------

function useEscape(onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', on);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

export function Sheet({ title, onClose, children, footer, width = 520 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(onClose);
  const id = useId();
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px] animate-[fade-up_0.2s_both]" onClick={onClose} />
      <aside className="animate-sheet relative flex h-full w-full flex-col bg-bg shadow-pop sm:m-2 sm:h-[calc(100%-16px)] sm:rounded-[22px]" style={{ maxWidth: width }}>
        <header className="flex items-center justify-between gap-3 px-6 pb-3 pt-5">
          <h2 id={id} className="display min-w-0 truncate text-[20px] font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose} className="bg-fill"><X className="size-4" /></IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-separator px-6 py-4">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  const id = useId();
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-pop relative w-full max-w-md rounded-[22px] bg-elevated p-6 shadow-pop">
        <h2 id={id} className="display text-[20px] font-semibold">{title}</h2>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Estados ----------

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-fill-2 text-label-3">{icon}</div>
      <h3 className="text-[17px] font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-[14px] text-label-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-red-soft px-4 py-3 text-[14px] text-red">
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="plain" onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

// ---------- Avisos (toasts) ----------

type ToastItem = { id: number; kind: 'success' | 'error'; text: string };
const ToastCtx = createContext<(kind: ToastItem['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} className="animate-pop pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full bg-elevated/90 py-2.5 pl-3.5 pr-5 text-[14px] font-medium shadow-pop backdrop-blur-xl">
            {t.kind === 'success' ? <CheckCircle2 className="size-5 shrink-0 text-green-fill" /> : <XCircle className="size-5 shrink-0 text-red-fill" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
