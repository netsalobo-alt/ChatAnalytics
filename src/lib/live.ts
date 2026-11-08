// Conexão ao vivo com o servidor (Server-Sent Events), compartilhada por todas as telas.

import { useEffect, useRef, useState } from 'react';

export type LiveEvent = 'lead' | 'sync' | 'webhook';
type Handler = (type: LiveEvent, data: Record<string, unknown>) => void;

let source: EventSource | null = null;
let connected = false;
const handlers = new Set<Handler>();
const statusListeners = new Set<(on: boolean) => void>();

function setConnected(on: boolean) {
  if (connected === on) return;
  connected = on;
  statusListeners.forEach((l) => l(on));
}

function ensure() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.onopen = () => setConnected(true);
  // O navegador reconecta sozinho; só marcamos como desconectado enquanto isso.
  source.onerror = () => setConnected(false);
  for (const type of ['lead', 'sync', 'webhook'] as LiveEvent[]) {
    source.addEventListener(type, (e) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch {
        /* ignora */
      }
      handlers.forEach((h) => h(type, data));
    });
  }
}

/** Fecha a conexão (ao sair do sistema). */
export function closeLive() {
  source?.close();
  source = null;
  setConnected(false);
}

/**
 * Chama `onChange` quando chegar algum dos eventos indicados.
 * Vários eventos em sequência viram uma única chamada (espera `delay` ms).
 */
export function useLive(types: LiveEvent[], onChange: () => void, delay = 800) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = types.join(',');
  useEffect(() => {
    ensure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wanted = new Set(key.split(','));
    const h: Handler = (type) => {
      if (!wanted.has(type)) return;
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), delay);
    };
    handlers.add(h);
    return () => {
      clearTimeout(timer);
      handlers.delete(h);
    };
  }, [key, delay]);
}

/** true enquanto a conexão ao vivo estiver ativa. */
export function useLiveStatus() {
  const [on, setOn] = useState(connected);
  useEffect(() => {
    ensure();
    statusListeners.add(setOn);
    setOn(connected);
    return () => {
      statusListeners.delete(setOn);
    };
  }, []);
  return on;
}
