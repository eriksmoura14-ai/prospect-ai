# Interface na Vercel, API no Render, dados no Neon

O frontend está preparado para publicação estática. As buscas e os jobs continuam
no processo Node.js do Render; contas, sessões e histórico continuam no Neon.
Não há cópia do banco nem mudança do agente ou da classificação comercial.

## Publicar

1. Na Vercel, importe **eriksmoura14-ai/prospect-ai**, branch **main**, diretório
   raiz do repositório. O `vercel.json` define framework **Other**, instalação
   `npm ci`, build `npm run build:frontend` e saída `dist`.
2. Publique a interface e copie a **URL de produção estável** atribuída ao projeto.
   URLs individuais de preview não serão autorizadas pelo backend.
3. No serviço **prospect-ai** do Render, adicione **apenas**
   `APP_FRONTEND_ORIGIN=https://URL-DE-PRODUCAO-DA-INTERFACE` e redeploy.
   Use a origem exata, sem caminhos, parâmetros, fragmentos ou curingas.
   Preserve `APP_ORIGIN` e todas as variáveis já existentes. O endereço do Render
   continua autorizado e operacional.
4. Verifique login, recarregamento, histórico, busca, acompanhamento do job,
   logout e cadastro/recuperação pelos links de e-mail no endereço da Vercel.
   A migração só está validada em produção depois desses testes.

Nenhuma chave de banco, Brevo, Geoapify, LocationIQ ou IA deve ser adicionada à
Vercel para esta arquitetura. As chaves continuam exclusivamente no Render.
Se o endereço estável mudar, atualize somente `APP_FRONTEND_ORIGIN` e repita os
testes. Para desfazer a autorização da interface, remova essa variável.

O plano Hobby gratuito da Vercel restringe-se a uso pessoal e não comercial;
para uso comercial da startup, escolha um plano que o permita. Este código não
contrata nem altera planos. Consulte a [política oficial do Hobby](https://vercel.com/docs/plans/hobby).

## Rotas e proteção

- `/api/*`, `/auth/logout` e `/health` são encaminhados ao Render por
  [external rewrites](https://vercel.com/docs/routing/rewrites). O navegador usa
  URLs relativas na própria Vercel; não depende de CORS ou cookies de terceiros.
- A validação exige a origem exata do Render ou da interface configurada, token
  CSRF e a sessão apropriada. `X-Forwarded-Host` não concede acesso. Previews,
  origens arbitrárias e cookies inválidos continuam recusados.
- Cookies mantêm `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em
  produção, sem `Domain`. Será necessário entrar no endereço novo; contas e
  histórico são os mesmos. Links futuros de cadastro e recuperação apontam para
  a interface configurada, com token no fragmento.
- Respostas da API e logout usam `no-store`, cache CDN desligado e
  `x-vercel-enable-rewrite-caching=0`. Cabeçalhos CSP e demais proteções do
  frontend são equivalentes aos aplicados pelo backend.
- `scripts/build-frontend.cjs` copia exclusivamente a lista pública de
  `static-resources.cjs`, incluindo imagens e módulos Three.js. Código do
  servidor, testes, schema SQL, caches e variáveis não entram em `dist`.
  Atribuições LocationIQ, Geoapify e OpenStreetMap são preservadas.

## Validação local e limites

Em 6 de outubro de 2026, a suíte Node passou **244 testes, sem falhas ou skips**,
com PostgreSQL real descartável. A configuração também foi validada contra o
schema oficial atual `https://openapi.vercel.sh/vercel.json`.

O teste `test/frontend-browser.py`, executado com Chromium, build estático e
backend/PostgreSQL separados em loopback, verifica login, reload, sessão no host
da interface, histórico, isolamento entre contas, CSRF, logout e arquivos privados.
Ele exige `TEST_DATABASE_URL` de PostgreSQL local descartável e
`FRONTEND_BROWSER_TEST=true` no harness `test/prospects-browser-server.cjs`.
As empresas e contas usadas são fixtures; não há consulta externa ou envio de
e-mail. Esse teste local não comprova publicação ou funcionamento na Vercel.

O backend permanece no plano atual do Render: seus limites, possíveis partidas
a frio e disponibilidade dos provedores externos continuam se aplicando.
