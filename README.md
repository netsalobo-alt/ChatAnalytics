# ChatAnalytics 3.0

Análise de leads e conversões do Chatwoot: webhook em tempo real, sincronização automática,
extração local de CPF / nascimento / CNH, funil de qualificação do SDR, vendas, investimentos
(CPL, CAC, ROAS) e canais. Interface clara inspirada no design da Apple, com modo escuro automático.

## Rodar localmente

```bash
npm install
npm run dev          # http://localhost:3000
```

No primeiro acesso a tela pede a criação da conta de administrador.

Banco de demonstração (dados fictícios, separado do real):

```bash
DATABASE_PATH=data/demo.db npx tsx scripts/seed-demo.ts
PORT=3100 DATABASE_PATH=data/demo.db npm run dev   # demo@chatanalytics.local / demo12345
```

## Produção (Docker / Portainer)

```bash
docker build -t chatanalytics .
docker run -d -p 3000:3000 -v chatanalytics_data:/app/data -e COOKIE_SECURE=true chatanalytics
```

Use `COOKIE_SECURE=true` atrás de HTTPS. O banco SQLite fica no volume `/app/data`.

## Chatwoot

1. Em **Integração**, informe URL, Account ID e o token de acesso (Perfil › Token de acesso).
2. Copie a URL do webhook e cadastre em Chatwoot › Configurações › Integrações › Webhooks,
   com os eventos *Mensagem criada*, *Conversa criada* e *Conversa atualizada*.
3. Clique em **Histórico completo** uma vez para importar as conversas antigas.

## Backup e migração da versão 2.0

Em **Integração › Backup e migração** (administrador):

- **Baixar backup**: JSON com leads, investimentos, caixas e configuração (inclui o token do Chatwoot; guarde com cuidado).
- **Importar arquivo**: aceita backups desta versão e do ChatAnalytics 2.0, inclusive o arquivo
  `data/chatanalytics_db.json` da versão antiga. *Mesclar* atualiza e acrescenta; *Substituir* apaga antes.
  Usuários nunca são alterados.

## Perfis

| Perfil | Pode |
| --- | --- |
| Administrador | Tudo, incluindo usuários e integração |
| Gestor | Leads, canais, investimentos, relatórios, exportação, sincronização |
| Operador | Painel e qualificação de leads |

## Estrutura

- `server/` — API Express, SQLite (`node:sqlite`), autenticação, Chatwoot, indicadores
- `shared/` — tipos, validação de CPF, extrator e datas (fuso de Belém)
- `src/` — interface React + Tailwind
- `tests/` — `npm test` (extrator, datas e API)
