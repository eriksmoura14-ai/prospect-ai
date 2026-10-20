# Prospect AI — teste isolado com Google Maps

Branch exclusiva: `test/google-maps-scraper`. Nenhuma alteração deve ser
mesclada à `main` para executar este teste.

## Integração

`google-maps.cjs` adapta a API de tarefas do motor
[`gosom/google-maps-scraper`](https://github.com/gosom/google-maps-scraper)
v1.18.1, o mesmo utilizado pelo
[`Mahanaicoach/google-maps-scraper-kit`](https://github.com/Mahanaicoach/google-maps-scraper-kit).
O kit e o motor têm licença MIT. Nenhuma skill externa é instalada ou
executada pelo aplicativo. O adaptador foi escrito neste projeto.

O servidor cria uma tarefa, acompanha seu estado, baixa o CSV, normaliza
os campos e reaproveita a verificação de sites e exportação do Prospect AI.
Os registros Google conservam `source=Google Maps`, `placeId`, `sourceUrl`,
`sourceCategory`, `rating` e `reviewCount`. O campo legado `osmId` recebe
`google:<id>` exclusivamente como identificador interno, sem inventar um
cadastro OSM nem fornecer um link OSM para ele.

Limites do experimento:

- Uma tarefa por vez, profundidade 3 e espera de 60 segundos entre buscas.
- Uma única palavra-chave por busca, sem grade de cidades nem proxies.
- Até 20 empresas selecionadas; a coleta do motor pode retornar mais linhas.
- Motor configurado com `max_time=180` segundos; acompanhamento até 205 segundos.
- E-mails, coleta adicional de avaliações e enriquecimento social desativados.
- Falha, resultado vazio e prazo excedido não disparam outra coleta automática.
- Em estado incerto, a instância bloqueia novas coletas até reinicialização:
  excluir uma tarefa no motor não cancela necessariamente o navegador em execução.
- Coordenadas fora do retângulo da cidade são descartadas. Esse retângulo não
  comprova pertencimento ao limite administrativo, nem cobertura completa.
- A categoria original fica visível: relevância da busca não prova ramo exato.
- Ausência de site no cadastro não comprova ausência de site na internet.

## Ambiente separado no Render

Criar **um novo serviço web**, nunca editar o serviço principal:

| Configuração | Valor |
|---|---|
| Nome | `prospect-ai-maps-test-erik` |
| Repositório | `https://github.com/eriksmoura14-ai/prospect-ai` |
| Branch | `test/google-maps-scraper` |
| Runtime | Docker |
| Dockerfile | `./Dockerfile.maps-test` |
| Contexto | `.` |
| Plano | Free, sem contratar upgrade automaticamente |
| Login | `AUTH_MODE=basic`, `APP_USER=erik-test` |
| Senha | `APP_PASSWORD` exclusiva, aleatória e com pelo menos 16 caracteres |
| Endereço | Render fornece `RENDER_EXTERNAL_URL`; não copiar APP_ORIGIN de produção |

O Dockerfile já define `PROSPECT_TEST_MODE=true` e
`BUSINESS_PROVIDER=google-maps`. O motor só escuta em `127.0.0.1:8080`,
sem expor sua API sem autenticação. O servidor do Prospect AI publica a
interface e a API na mesma origem, usando a porta fornecida pelo Render.

Não copiar variáveis, contas, banco de dados, chaves de IA/e-mail ou
credenciais do serviço original. O modo de teste rejeita essas configurações.
Histórico e resultados são temporários; exportar CSV/JSON antes de reiniciar.
O login do teste é separado e não exige Gmail nem envio de e-mail.

As configurações Vercel e Netlify desta branch apontam exclusivamente para
`https://prospect-ai-maps-test-erik.onrender.com`; elas não chamam o backend
principal. A implantação inicial serve tudo diretamente pelo Render.

## Validação e limites pendentes

Executar `npm ci --ignore-scripts` e `npm test`. Os testes novos usam um motor
HTTP simulado, identificado como fixture, e dados fictícios. Eles validam o
contrato de integração, não a cobertura real do Google Maps.

Validação local desta implementação: **271 testes aprovados, nenhum reprovado
e um teste de contas com PostgreSQL ignorado por falta de banco local**.
`npm run build:frontend` e verificações de sintaxe também passaram. O fluxo
HTTP completo foi validado com o motor simulado; nenhum contato real foi coletado.

O workflow `.github/workflows/maps-test.yml` constrói a imagem no GitHub e
verifica inicialização, login separado e configuração do provedor. Ele não
recebe credenciais de produção, publica imagens nem inicia coleta real.

Antes de considerar o teste pronto para uso: construir o Dockerfile, verificar
o serviço ao vivo, autenticar com o login próprio e executar uma única busca
pequena. Este ambiente local não dispõe de Docker, portanto a imagem ainda
precisa ser construída e a coleta real validada no serviço separado.

Chromium pode exceder os recursos do plano gratuito. Se ocorrer, registrar
a falha e discutir alternativas; não contratar plano pago automaticamente.
O kit também documenta possibilidade de bloqueios e conflito com os termos
do Google Maps. Software gratuito não implica operação sem limites.
