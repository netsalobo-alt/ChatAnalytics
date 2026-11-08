// Sincronização automática periódica com o Chatwoot e limpeza de dados temporários.

import { purgeExpiredSessions } from './auth.ts';
import { isSyncing, syncConversations } from './chatwoot.ts';
import { chatwootReady, getSettings } from './settings.ts';
import { purgeProcessedMessages } from './store.ts';

let timer: NodeJS.Timeout | null = null;

export function rescheduleAutoSync() {
  if (timer) clearTimeout(timer);
  const s = getSettings();
  if (!s.auto_sync_enabled || !chatwootReady(s)) return;
  const interval = Math.max(2, s.auto_sync_minutes) * 60_000;
  const elapsed = s.last_sync_at ? Date.now() - Date.parse(s.last_sync_at) : Infinity;
  const wait = Math.max(5_000, Math.min(interval, interval - elapsed));
  timer = setTimeout(async () => {
    if (!isSyncing()) {
      try {
        const r = await syncConversations();
        console.log(`[auto-sync] ${r.message}`);
      } catch (err) {
        console.warn(`[auto-sync] ${(err as Error).message}`);
      }
    }
    rescheduleAutoSync();
  }, wait);
  timer.unref();
}

export function startHousekeeping() {
  const run = () => {
    purgeExpiredSessions();
    purgeProcessedMessages();
  };
  run();
  setInterval(run, 6 * 60 * 60_000).unref();
}
