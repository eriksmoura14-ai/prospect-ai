# Prospect AI: interface na Netlify, backend no Render, banco no Neon

## Configuração

Importe o repositório **eriksmoura14-ai/prospect-ai**, branch **main**, raiz do
repositório, no plano **Free** da Netlify. O `netlify.toml` define:

- Build: `npm run build:frontend`.
- Diretório público: `dist`.
- Funções: `netlify/functions`, separado do diretório público.

Não adicione credenciais de banco, e-mail, geocodificação ou IA à Netlify.
Elas continuam no serviço **prospect-ai** do Render. A única função na Netlify
encaminha HTTP para esse serviço; não executa descoberta, agente ou banco.

Após criar e publicar o projeto, copie seu endereço **de produção estável**.
No Render, adicione somente:

```
APP_FRONTEND_ORIGIN=https://ENDERECO-ESTAVEL.netlify.app
```

Preserve `APP_ORIGIN` e todas as variáveis existentes; faça redeploy. Essa
variável autoriza a origem exata da interface e direciona os próximos links de
cadastro e recuperação para ela. Não aceita curingas, caminhos ou URLs de preview.
O Render continua acessível pelo endereço atual. Para remover a autorização da
Netlify, remova somente `APP_FRONTEND_ORIGIN` e faça redeploy.

No acesso novo será necessário entrar novamente. Contas, pesquisas e listas são
as mesmas no Neon; não há cópia ou nova base de dados.

## Encaminhamento, tempos e segurança

As rotas `/api/*`, `/auth/logout` e `/health` usam
`netlify/functions/render-api.mjs`, com streaming. O backend é fixo:
`https://prospect-ai-a90q.onrender.com`. URLs fornecidas pelo navegador e headers
encaminhados não podem trocar o destino. Cookies individuais, origem original,
CSRF, método e query são preservados. A função não segue redirects do backend
com cookies e não reenvia solicitações automaticamente.

O [proxy simples da Netlify](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)
tem limite de 26 segundos. A função Node usada aqui tem
[limite de execução de 60 segundos e resposta em streaming de até 20 MB](https://docs.netlify.com/build/functions/configuration/).
Seu prazo de conexão e resposta upstream é **55 segundos**, para devolver um
erro tratável antes do limite da plataforma. Isso permite a sequência já
existente da IA: até 12 segundos para evidências e até 40 para geração, além das
leituras de conta. Não é garantia de conclusão: atrasos adicionais no banco ou
na rede podem atingir o prazo. Diagnósticos Overpass que demorarem 65 segundos
devem ser usados diretamente pelo endereço do Render, que mantém seus limites.

As buscas comerciais já respondem com um job e continuam no Render. O navegador
consulta o andamento pela função; área geográfica, classificação, categorias e
agente permanecem intactos. O banco permanece no Neon.

O Render gratuito pode iniciar lentamente após inatividade. A interface mostra
uma mensagem de conexão e repete **somente o GET inicial de `/api/account`** em
falhas de rede ou HTTP 502/503/504, até quatro tentativas de 15 segundos com três
intervalos de um segundo. Depois mostra **Tentar novamente**. Cadastro, login,
e-mails e buscas não são repetidos automaticamente após resposta incerta.

O frontend preserva CSP e demais headers de segurança. Respostas da função,
incluindo erros, usam `private, no-store` e cache CDN desativado. Tokens CSRF,
cookies `HttpOnly/Secure/SameSite=Lax` e isolamento de contas continuam no backend.
A função aceita apenas o endereço de produção informado pelo contexto da Netlify.
Previews não são autorizados. Código de funções e backend não entra em `dist`.

## Testes realizados em 6 de outubro de 2026

- **249 testes Node passaram**, sem falhas ou skips, com PostgreSQL real
  descartável. Testes de HTTP real confirmam o prazo da função e streaming de
  uma resposta de 7 MB; os dados são controlados localmente.
- `netlify build --offline`, com CLI oficial 27.11.2, compilou a interface e a
  função. O manifest confirmou `invocationMode=stream` e as três rotas esperadas.
- Chromium, no computador e celular, testou build estático, a função real de
  encaminhamento e backend/PostgreSQL locais: login, reload, histórico, logout,
  isolamento de contas, CSRF, cookies, arquivos privados e ausência de chamadas
  diretas do navegador ao backend.
- Falhas controladas no navegador confirmaram recuperação inicial, limite de
  quatro tentativas e ausência de reenvio automático do POST de login. Isso
  não comprova a duração real de uma partida a frio no Render.

Esses testes não comprovam publicação ou disponibilidade na Netlify. Depois de
autorizar a conta, publicar e configurar a origem no Render, valide também login,
cadastro/recuperação por e-mail, pesquisa real e acompanhamento do job, histórico,
logout e geração de IA no endereço de produção. Não declare a migração concluída
antes desses testes.

## Plano gratuito

A Netlify permite projetos comerciais no Free. O
[plano atual](https://www.netlify.com/pricing/) tem 300 créditos por mês;
publicações, transferência e requisições consomem essa quota. Ao esgotá-la, os
projetos podem ser pausados até o ciclo seguinte. Este código não contrata planos,
adicionais ou banco Netlify. Prefira validar em preview antes de publicar novas
versões; cada publicação em produção consome créditos.
