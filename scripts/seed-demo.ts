// Gera um banco de demonstração com dados fictícios. Uso: DATABASE_PATH=data/demo.db npx tsx scripts/seed-demo.ts
if (!process.env.DATABASE_PATH?.includes('demo')) {
  console.error('Por segurança, use um DATABASE_PATH contendo "demo".');
  process.exit(1);
}
const { db } = await import('../server/db.ts');
const { createFirstAdmin } = await import('../server/auth.ts');
const { saveRemoteInboxes, addInvestment } = await import('../server/store.ts');
const { upsertFromChatwoot, updateLead } = await import('../server/leads.ts');

db.exec('DELETE FROM leads; DELETE FROM investments; DELETE FROM inboxes;');
if (!createFirstAdmin({ name: 'Admin Demo', email: 'demo@chatanalytics.local', password: 'demo12345' })) {
  console.log('Admin demo já existe.');
}
const inboxes = [
  { id: 34, name: 'Vr_Padrão', channel_type: 'Channel::Api' },
  { id: 37, name: 'Edely', channel_type: 'Channel::Api' },
  { id: 40, name: 'Instagram Loja', channel_type: 'Channel::Instagram' },
  { id: 41, name: 'Site', channel_type: 'Channel::WebWidget' },
];
saveRemoteInboxes(inboxes);
const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Hugo', 'Iara', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Tiago', 'Vitória', 'Wesley'];
const last = ['Souza', 'Lima', 'Costa', 'Pereira', 'Almeida', 'Ferreira', 'Rodrigues', 'Barbosa', 'Cardoso', 'Monteiro'];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const vendedores = ['Carlos', 'Juliana', 'Renato'];
for (let i = 0; i < 260; i++) {
  const daysAgo = Math.floor(Math.pow(rnd(), 1.4) * 75);
  const entry = new Date(Date.now() - daysAgo * 86400_000 - rnd() * 36_000_000);
  const ib = pick([inboxes[0], inboxes[0], inboxes[1], inboxes[2], inboxes[3]]);
  const name = `${pick(first)} ${pick(last)}`;
  const { lead } = upsertFromChatwoot({
    account_id: '5', contact_id: 1000 + i, conversation_id: 5000 + i, contact_name: name,
    contact_phone: `+55919${String(80000000 + Math.floor(rnd() * 9999999))}`,
    channel: ib.channel_type.includes('Instagram') ? 'Instagram' : ib.channel_type.includes('Web') ? 'Webchat' : 'WhatsApp',
    inbox_id: ib.id, inbox_name: ib.name, tags: rnd() > 0.5 ? ['trafego_pago'] : [],
    entry_date: entry.toISOString(), last_interaction_at: new Date(entry.getTime() + 3600_000).toISOString(),
    chatwoot_url: null, messages: [{ text: 'Olá, vi o anúncio e quero saber mais', timestamp: entry.getTime() }],
  });
  const r = rnd();
  if (r < 0.2) updateLead(lead.id, { status: 'APROVADO', valor_venda: Math.round(800 + rnd() * 4200), vendedor: pick(vendedores) });
  else if (r < 0.32) updateLead(lead.id, { status: 'REPROVADO', motivo_reprovacao: pick(['Score baixo', 'Sem entrada', 'Desistiu']) });
  else if (r < 0.45) updateLead(lead.id, { status: 'EM_ANALISE', cpf: '529.982.247-25', cnh: 'SIM' });
  else if (r < 0.55) updateLead(lead.id, { status: 'PENDENTE' });
  // Venda registrada no dia do lead (aproximação para demo)
  db.prepare('UPDATE leads SET sale_date = ? WHERE id = ? AND vendeu = 1').run(new Date(Math.min(Date.now(), entry.getTime() + rnd() * 3 * 86400_000)).toISOString(), lead.id);
}
for (let m = 0; m < 3; m++) {
  for (const [ch, base] of [['Meta Ads', 1800], ['Google Ads', 700]] as const) {
    const d = new Date(Date.now() - m * 30 * 86400_000);
    addInvestment({ date: d.toISOString().slice(0, 10), amount: Math.round(base + rnd() * 600), channel: ch });
  }
}
console.log('Banco demo pronto: demo@chatanalytics.local / demo12345');
