# Instalar o ChatAnalytics no Portainer (analytics.m2auto.com.br)

O sistema roda num único container com banco SQLite. Os dados ficam no volume `chatanalytics_data`.

A imagem é montada automaticamente pelo GitHub a cada atualização do `main`, e o Portainer só precisa baixá-la:
`ghcr.io/netsalobo-alt/chatanalytics:latest` (servidores Intel/AMD ou ARM).

## 1. Antes de começar (uma vez só)

1. **DNS.** `analytics.m2auto.com.br` já aponta para o servidor (135.181.88.165). Nada a fazer.
2. **Acesso à imagem.** O repositório é privado, então a imagem também é. Cadastre o GitHub como registro no Portainer:
   - no GitHub, crie um token em **Settings › Developer settings › Personal access tokens › Tokens (classic)**,
     só com a permissão `read:packages`;
   - no Portainer, abra **Registries › Add registry › Custom registry**:
     - Name: `GHCR`
     - Registry URL: `ghcr.io`
     - marque **Authentication**, usuário `netsalobo-alt` e o token como senha.

   Também é possível deixar o pacote público (https://github.com/netsalobo-alt?tab=packages › **chatanalytics** ›
   **Package settings › Change visibility**). Isso expõe o código da aplicação, mas não os dados.
3. **Dados do Traefik.** O servidor já tem um Traefik nas portas 80/443 (é ele que serve o `m2auto.com.br`), na rede
   **`Mosqueironet`** (Traefik v3 em Docker Swarm). O compose usa as mesmas labels da stack do M2: rede `Mosqueironet`,
   entrypoint `websecure` e certresolver `letsencryptresolver`. Para conferir, veja a stack do M2 ou a do Traefik:
   - **Portainer › Stacks › m2-veiculos › Editor**, procure as linhas `traefik.`:
     - `...entrypoints=` (hoje `websecure`);
     - `...tls.certresolver=` (hoje `letsencryptresolver`);
     - `traefik.swarm.network=` (hoje `Mosqueironet`).
     Se algum mudar, ajuste a linha correspondente no `docker-compose.yml`.
   - Se a stack do M2 não tiver essas linhas, veja em **Containers › (container do traefik) › Inspect**:
     a rede aparece em *Networks* e os nomes do entrypoint e do certresolver nos argumentos (`--entrypoints.NOME.address=:443`,
     `--certificatesresolvers.NOME.acme...`).

## 2. Criar a stack

1. No Portainer, abra **Stacks › Add stack**.
2. Em **Name**, use `chatanalytics`.
3. Em **Build method**, escolha **Web editor** e cole o conteúdo de [`docker-compose.yml`](../docker-compose.yml).
   (O método **Repository** também funciona, mas exige cadastrar credenciais do GitHub, já que o repositório é privado.)
4. Em **Environment variables**, adicione:

   | Nome | Valor | Obrigatória |
   | --- | --- | --- |
   | `ADMIN_EMAIL` | e-mail do administrador | sim |
   | `ADMIN_PASSWORD` | senha forte, mínimo 8 caracteres | sim |
   | `ADMIN_NAME` | nome exibido (padrão `Administrador`) | não |

   O administrador é criado **só na primeira vez**, com o banco vazio. Depois, a senha é trocada pelo próprio sistema
   e as variáveis deixam de ter efeito.
5. Clique em **Deploy the stack**.
6. Em **Containers**, o `chatanalytics` deve ficar **healthy** em até 1 minuto. Abra https://analytics.m2auto.com.br:
   na primeira visita o Traefik emite o certificado, o que leva alguns segundos.

## 3. Como o HTTPS funciona

Não há portas publicadas: o Traefik recebe o acesso em 443, emite o certificado Let's Encrypt para o domínio e encaminha
para a porta 3000 do container pela rede `TRAEFIK_NETWORK`. O redirecionamento de HTTP para HTTPS já é feito pelo
Traefik do servidor.

O sistema confia no proxy (`trust proxy`): marca o cookie como `Secure` e monta a URL do webhook com
`https://analytics.m2auto.com.br` automaticamente.

As labels ficam em `deploy.labels`, que é onde o Traefik em Docker Swarm as lê.

## 4. Primeiro acesso

1. Abra o endereço HTTPS e entre com `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
2. Em **Integração**:
   - informe a URL do Chatwoot, o Account ID e o token de acesso, e clique em **Salvar** (a conexão é testada antes);
   - copie a **URL do webhook** e cadastre no Chatwoot (Configurações › Integrações › Webhooks), com os eventos
     *Mensagem criada*, *Conversa criada* e *Conversa atualizada*;
   - clique em **Histórico completo** uma vez para importar as conversas antigas.
3. Para trazer os dados da versão 2.0: **Integração › Backup e migração › Importar arquivo**, com o backup antigo ou o
   arquivo `chatanalytics_db.json` do volume da versão anterior.
4. Em **Usuários**, crie os logins da equipe.

## 5. Atualizar o sistema

Cada mudança no `main` publica uma imagem nova em alguns minutos (aba **Actions**, workflow "Imagem Docker").
Para aplicar: abra a stack, clique em **Update the stack** e marque **Re-pull image and redeploy**.

Os dados ficam no volume e não são afetados. Para voltar a uma versão anterior, troque `latest` por `sha-xxxxxxx`
(as tags aparecem na página do pacote no GitHub).

## 6. Backup

Pela interface: **Integração › Backup e migração › Baixar backup** (JSON com tudo, menos os usuários).

Pelo servidor, cópia do banco inteiro com o sistema rodando:
```bash
docker run --rm -v chatanalytics_data:/data -v "$PWD":/backup alpine \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/chatanalytics.db '.backup /backup/chatanalytics-$(date +%F).db'"
```

Restaurar (com a stack parada):
```bash
docker run --rm -v chatanalytics_data:/data -v "$PWD":/backup alpine \
  sh -c "cp /backup/chatanalytics-AAAA-MM-DD.db /data/chatanalytics.db && rm -f /data/chatanalytics.db-wal /data/chatanalytics.db-shm && chown -R 1000:1000 /data"
```

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Deploy falha com "Defina ADMIN_EMAIL/ADMIN_PASSWORD" | variável não preenchida | adicione em Environment variables |
| `unauthorized` ou `denied` ao baixar a imagem | registro GHCR não cadastrado, ou imagem ainda não publicada | item 1; confira se o workflow está verde |
| Deploy falha com "network ... not found" | rede com nome errado | confira o nome exato da rede (item 1.3) |
| Site responde `404 page not found` | serviço não está rodando, ou labels erradas | em Services, veja se está 1/1 e abra as Tasks para ler o erro |
| `Gateway Timeout` / `Bad Gateway` | serviço em outra rede | a rede da stack precisa ser a mesma do Traefik |
| Navegador acusa "TRAEFIK DEFAULT CERT" | certresolver com nome errado | ajuste a label `certresolver` e atualize a stack |
| Login não fica salvo | acesso por `http` | use sempre https://analytics.m2auto.com.br |
| Container reinicia com `EACCES` | pasta do host com outro dono | use o volume nomeado do compose, ou `chown -R 1000:1000` na pasta |
