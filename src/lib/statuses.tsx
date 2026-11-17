// Status dos leads configuráveis, carregados do servidor e compartilhados por todas as telas.

import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { api } from './api.ts';
import { useAsync } from './hooks.ts';
import { useLive } from './live.ts';
import { DEFAULT_STATUSES, type StatusColor, type StatusDef } from '../../shared/types.ts';

interface StatusesCtx {
  list: StatusDef[];
  get: (key: string) => StatusDef | undefined;
  label: (key: string) => string;
  reload: () => void;
}

const Ctx = createContext<StatusesCtx>({
  list: DEFAULT_STATUSES,
  get: (k) => DEFAULT_STATUSES.find((s) => s.key === k),
  label: (k) => DEFAULT_STATUSES.find((s) => s.key === k)?.label ?? k,
  reload: () => {},
});

export function StatusesProvider({ children }: { children: ReactNode }) {
  const res = useAsync(() => api.get<StatusDef[]>('/statuses'), []);
  useLive(['statuses'], res.reload, 150);
  const value = useMemo<StatusesCtx>(() => {
    const list = res.data ?? DEFAULT_STATUSES;
    const map = new Map(list.map((s) => [s.key, s]));
    return {
      list,
      get: (k) => map.get(k),
      label: (k) => map.get(k)?.label ?? 'Status removido',
      reload: res.reload,
    };
  }, [res.data, res.reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStatuses = () => useContext(Ctx);

/** Cor cheia (ponto, gráfico) de uma cor de status. */
export const statusFill = (c: StatusColor | undefined) => `var(--st-${c ?? 'gray'})`;

/** Estilos do selo: fundo suave e texto na cor do status. */
export function statusPillStyle(c: StatusColor | undefined): CSSProperties {
  const color = c ?? 'gray';
  return {
    background: `color-mix(in srgb, var(--st-${color}) 15%, transparent)`,
    color: `var(--st-${color}-text)`,
  };
}

export const STATUS_COLOR_NAME: Record<StatusColor, string> = {
  blue: 'Azul',
  indigo: 'Índigo',
  purple: 'Roxo',
  pink: 'Rosa',
  red: 'Vermelho',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  teal: 'Azul-petróleo',
  gray: 'Cinza',
};
