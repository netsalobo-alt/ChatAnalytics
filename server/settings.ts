// Configurações chave/valor persistidas no SQLite.

import crypto from 'node:crypto';
import { db } from './db.ts';

export interface SettingsShape {
  chatwoot_url: string;
  account_id: string;
  api_token: string;
  webhook_secret: string;
  auto_sync_enabled: boolean;
  auto_sync_minutes: number;
  labels_on_approve: string;
  labels_on_reject: string;
  last_sync_at: string | null;
  last_sync_status: 'idle' | 'syncing' | 'success' | 'error';
  last_sync_message: string | null;
}

const DEFAULTS: SettingsShape = {
  chatwoot_url: '',
  account_id: '',
  api_token: '',
  webhook_secret: '',
  auto_sync_enabled: true,
  auto_sync_minutes: 10,
  labels_on_approve: 'Aprovado, Ganhamos',
  labels_on_reject: 'Reprovado',
  last_sync_at: null,
  last_sync_status: 'idle',
  last_sync_message: null,
};

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);

export function getSetting<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
  const row = getStmt.get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as SettingsShape[K]) : DEFAULTS[key];
}

export function setSettings(values: Partial<SettingsShape>) {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) setStmt.run(k, JSON.stringify(v));
  }
}

export function getSettings(): SettingsShape {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof SettingsShape)[]) {
    (out as Record<string, unknown>)[key] = getSetting(key);
  }
  return out;
}

/** Segredo usado na URL do webhook do Chatwoot; gerado na primeira chamada. */
export function webhookSecret(): string {
  let secret = getSetting('webhook_secret');
  if (!secret) {
    secret = crypto.randomBytes(18).toString('base64url');
    setSettings({ webhook_secret: secret });
  }
  return secret;
}

export function chatwootReady(s = getSettings()): boolean {
  return Boolean(s.chatwoot_url && s.account_id && s.api_token);
}

export function parseLabels(list: string): string[] {
  return list.split(',').map((l) => l.trim()).filter(Boolean);
}
