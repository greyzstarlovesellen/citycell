# API da City Cell

A API roda em Cloudflare Workers. Ela lê e atualiza `data/citycell.json` no repositório privado `greyzstarlovesellen/citycell`. O token do GitHub fica somente como secret do Worker. A API exige senha compartilhada e emite uma sessão assinada com validade de oito horas. Alterações concorrentes são recusadas com HTTP 409 para impedir que uma gravação apague a edição de outra sessão.

## Configuração

1. Crie um token fine-grained do GitHub limitado ao repositório `citycell`, com permissão **Contents: Read and write**. Não coloque esse token no site nem no repositório.
2. Instale Node.js e Wrangler e autentique a conta Cloudflare (`npx wrangler login`).
3. Altere `FRONTEND_ORIGIN` em `wrangler.toml` para a origem exata onde o site será publicado. Não inclua caminho, barra final ou wildcard.
4. Grave os secrets do Worker:

   ```powershell
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put APP_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```

   Use uma senha longa compartilhada entre os dois usuários e um valor aleatório com pelo menos 32 bytes para `SESSION_SECRET`.
5. Publique a API:

   ```powershell
   npx wrangler deploy
   ```

6. Copie a URL `workers.dev` retornada para `window.CITYCELL_API_URL` em `config.js`, sem a barra final, por exemplo `https://citycell-api.seu-usuario.workers.dev`.
7. Publique `index.html`, `app.js`, `config.js` e `logo-citycell.png` em uma hospedagem estática. O domínio publicado precisa coincidir com `FRONTEND_ORIGIN`.

## Rotas

- `POST /api/login` com `{ "password": "..." }` retorna uma sessão Bearer.
- `GET /api/data` retorna os dados e a versão do arquivo.
- `PUT /api/data` recebe `{ "version": "...", "data": { "products": [], "sales": [], "expenses": [], "customers": [] } }`.
- `GET /api/health` verifica se o Worker está respondendo.

Cada gravação cria uma nova versão no histórico Git. Remover dados do arquivo atual não os remove das versões anteriores. Portanto, evitem armazenar informações de clientes além do que precisam para operar a loja.

