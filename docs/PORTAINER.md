# Instalar o ChatAnalytics no Portainer

O sistema roda num único container com banco SQLite. Os dados ficam no volume `chatanalytics_data`.

A imagem é montada automaticamente pelo GitHub a cada atualização do `main`, e o Portainer só precisa baixá-la:
`ghcr.io/netsalobo-alt/chatanalytics:latest` (servidores Intel/AMD ou ARM).

## 1. Antes de começar (uma vez só)

1. **Acesso à imagem.** O repositório é privado, então a imagem também é. Cadastre o GitHub como registro no Portainer:
   - no GitHub, crie um token em **Settings › Developer settings › Personal access tokens › Tokens (classic)**,
     só com a permissão `read:packages`;
   - no Portainer, abra **Registries › Add registry › Custom registry**:
     - Name: `GHCR`
     - Registry URL: `ghcr.io`
     - marque **Authentication**, usuário `netsalobo-alt` e o token como senha.

   Também é possível deixar o pacote público (https://github.com/netsalobo-alt?tab=packages › **chatanalytics** ›
   **Package settings › Change visibility**). Isso expõe o código da aplicação, mas não os dados.
2. **Um domínio** apontando para o servidor, por exemplo `analytics.nortetelecom.net.br`. O HTTPS é necessário
   para o login (cookie seguro) e para o webhook do Chatwoot.

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
   | `PORTA` | porta no servidor (padrão `3001`; a `3000` já é do M2 Seminovos) | não |

   O administrador é criado **só na primeira vez**, com o banco vazio. Depois, a senha é trocada pelo próprio sistema
   e as variáveis deixam de ter efeito.
5. Clique em **Deploy the stack**.
6. Em **Containers**, o `chatanalytics` deve ficar **healthy** em até 1 minuto. Teste em `http://IP-DO-SERVIDOR:3001`.

## 3. HTTPS (obrigatório em produção)

**Nginx Proxy Manager:**
- **Proxy Hosts › Add Proxy Host**:
  - Domain: `analytics.nortetelecom.net.br`
  - Scheme: `http`
  - Forward Hostname/IP: o IP do servidor (ou `chatanalytics`, se estiverem na mesma rede Docker)
  - Forward Port: `3001` (ou `3000` se usar o nome do container na mesma rede)
  - marque **Block Common Exploits**
- Aba **SSL**: **Request a new SSL Certificate**, marque **Force SSL** e **HTTP/2**.
- Aba **Advanced**, para importar backups grandes:
  ```
  client_max_body_size 200m;
  ```

**Traefik:** adicione estas labels ao serviço (troque o domínio e o certresolver) e remova a seção `ports`:
```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.chatanalytics.rule=Host(`analytics.nortetelecom.net.br`)
      - traefik.http.routers.chatanalytics.entrypoints=websecure
      - traefik.http.routers.chatanalytics.tls.certresolver=letsencrypt
      - traefik.http.services.chatanalytics.loadbalancer.server.port=3000
```

O sistema confia no proxy (`trust proxy`): marca o cookie como `Secure` e monta a URL do webhook com `https`
automaticamente.

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
| Porta já em uso | a 3000 é do M2 | mantenha `PORTA=3001` ou outra livre |
| Login não fica salvo | acesso por `http` atrás de proxy sem `X-Forwarded-Proto` | acesse pelo `https` do proxy |
| URL do webhook aparece com `http://` | proxy não envia `X-Forwarded-Proto` | no NPM já vem configurado; no Nginx manual, adicione `proxy_set_header X-Forwarded-Proto $scheme;` |
| Importação de backup falha por tamanho | limite do proxy | `client_max_body_size 200m;` |
| Container reinicia com `EACCES` | pasta do host com outro dono | use o volume nomeado do compose, ou `chown -R 1000:1000` na pasta |
