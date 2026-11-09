// Banco SQLite (módulo nativo node:sqlite) com migrações versionadas.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DATABASE_PATH || path.resolve('data', 'chatanalytics.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','manager','operator')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE inboxes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    custom_name TEXT
  );
  CREATE TABLE leads (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    contact_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL DEFAULT 0,
    contact_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    entry_date TEXT NOT NULL,
    last_interaction_at TEXT NOT NULL,
    cpf TEXT,
    cpf_valid INTEGER NOT NULL DEFAULT 0,
    birth_date TEXT,
    cnh TEXT,
    status TEXT NOT NULL DEFAULT 'NOVO',
    vendedor TEXT,
    loja TEXT,
    vendeu INTEGER NOT NULL DEFAULT 0,
    valor_venda REAL NOT NULL DEFAULT 0,
    sale_date TEXT,
    observacao TEXT,
    motivo_reprovacao TEXT,
    chatwoot_url TEXT,
    channel TEXT NOT NULL DEFAULT 'Outros',
    inbox_id INTEGER,
    inbox_name TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    last_message TEXT,
    manual_fields TEXT NOT NULL DEFAULT '[]',
    field_origins TEXT NOT NULL DEFAULT '{}',
    cpf_conflict TEXT,
    recent_messages TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX leads_entry ON leads(entry_date);
  CREATE INDEX leads_sale ON leads(sale_date);
  CREATE INDEX leads_status ON leads(status);
  CREATE INDEX leads_inbox ON leads(inbox_id);
  CREATE INDEX leads_phone ON leads(account_id, contact_phone);
  CREATE TABLE investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    channel TEXT NOT NULL DEFAULT 'Geral',
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX investments_date ON investments(date);
  CREATE TABLE webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    conversation_id INTEGER,
    contact_name TEXT,
    lead_id TEXT
  );
  CREATE TABLE processed_messages (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE leads ADD COLUMN veiculo TEXT;
  ALTER TABLE leads ADD COLUMN criativo TEXT;
  CREATE INDEX leads_criativo ON leads(criativo);
  `,
];

function migrate() {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Executa `fn` dentro de uma transação (suporta aninhamento simples). */
let depth = 0;
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

migrate();

export const nowIso = () => new Date().toISOString();
