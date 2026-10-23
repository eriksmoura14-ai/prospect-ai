# Motor global de descoberta — MVP para desenvolvimento/homologação

O motor é **opcional e desativado por padrão**. `DISCOVERY_ENGINE=legacy` conserva a busca atual. Esta entrega não migra nem publica a produção.

## Fluxo

1. Validar a seleção existente de país, subdivisão, cidade e segmento.
2. Reutilizar a área confirmada do catálogo; caso necessário, geocodificar com `polygon_geojson=1`, conferir o país/subdivisão e preservar Polygon/MultiPolygon inteiro.
3. Consultar o PostGIS com envelope indexado + `ST_Covers`, incluindo buracos e partes separadas.
4. Entregar registros locais como progresso e consultar somente fontes cuja cobertura precisa de atualização, sob orçamento.
5. Normalizar sem inventar telefone, website, nono dígito ou tags. OSM e Overture usam classificadores próprios.
6. Conservar registros por fonte; deduplicar a apresentação por ID ou nome, proximidade e evidência de contato/endereço. Divergência de telefone bloqueia destinatário automático.
7. Persistir fatos públicos permitidos, licenças, origem, datas e qualidade. Registrar cobertura e checkpoint; reaproveitar consultas recentes.
8. Executar a verificação limitada dos websites; pendências continuam explícitas.

## Banco separado e migração explícita

O catálogo usa `DISCOVERY_DATABASE_URL`, distinto da configuração da autenticação. Não há migração automática no startup. Os testes usam PostgreSQL 17/PostGIS 3.5 descartável em loopback. A migração também foi aplicada em um projeto Neon gratuito novo e isolado, com PostgreSQL 17/PostGIS 3.5.7; nenhum dado privado foi copiado da produção. Supabase não foi testado remotamente.

Exemplo **somente local**, com senha fictícia:

```bash
docker run --rm --name prospect-discovery-local \
  -e POSTGRES_PASSWORD=local-fixture-only -e POSTGRES_DB=prospect_audit_discovery \
  -p 127.0.0.1:55438:5432 postgis/postgis:17-3.5
```

Em outro terminal:

```bash
export DISCOVERY_DATABASE_URL='postgresql://postgres:local-fixture-only@127.0.0.1:55438/prospect_audit_discovery'
npm run discovery -- migrate --apply
export DISCOVERY_ENGINE=global
export DISCOVERY_LOCAL=true
export DISCOVERY_SOURCES=qlever,overpass
npm start
```

Mantenha as variáveis atuais de autenticação para usar as contas. Nenhuma chave da produção deve ser copiada para testes. Para uma migração remota de homologação, use URL direta/não pooled, revise `db/discovery.sql` e indique `DISCOVERY_REMOTE_TARGET=development`. Não use esse sinalizador para autorizar produção. O runtime pode usar a conexão pooled. Não use prefixos `VITE_`, `NEXT_PUBLIC_` ou equivalentes nas URLs do banco.

### Modelo de dados

- `discovery_areas`: identidade, país, área Polygon/MultiPolygon válida, metadados e cache de resolução.
- `discovery_records`: UUID interno estável do registro da fonte, nome normalizado, categoria, país/estado/cidade/endereço, Point 4326, telefone/site públicos, licença, proveniência, confiança de existência quando fornecida, datas e estado de verificação.
- `discovery_coverage`: atualização por **área exata + segmento + fonte**, completude operacional e expiração.
- `discovery_tasks`: dono da solicitação, estado, tentativas, concessão com token, checkpoint e retomada.

Índices GiST nas geometrias, índices por país/categoria/nome e unicidade de `(source, source_id)`. Registros OSM/Overture não são sobrescritos uns pelos outros. A gravação consulta identidades existentes uma vez e envia lotes de até 100 registros, dentro da mesma transação e dos mesmos limites/licenças/leases. Isso evita duas viagens de rede por estabelecimento. IDs repetidos conservam a observação mais recente. Milhões de registros são uma evolução do modelo/indexação, **não uma escala validada nem permitida pelo orçamento padrão**; importações maciças ainda exigirão ingestão e testes de carga próprios.

O UUID identifica o registro da fonte. A resolução de entidades entre fontes é conservadora por consulta; não existe ainda um grafo mundial canônico de empresas. Favoritos antigos não são migrados ou fundidos automaticamente.

## Overture regional

Instalação opcional de ferramentas em ambiente virtual (Linux; PBF pode usar WSL):

```bash
python3 -m venv .venv-discovery
.venv-discovery/bin/pip install -r tools/discovery-requirements.txt
.venv-discovery/bin/python scripts/setup-discovery.py
export OVERTURE_PYTHON="$PWD/.venv-discovery/bin/python"
export DISCOVERY_SOURCES=qlever,overture
```

O setup instala uma extensão `httpfs` assinada da versão fixa do DuckDB, por HTTPS verificado. O leitor consulta STAC oficial e arquivos Places da release **2026-10-21.0**, filtra arquivos/row groups por bbox e lê somente colunas necessárias. A seleção final usa o polígono completo no Node/PostGIS. A geometria Point é decodificada do WKB; o canto do bbox não é usado como coordenada exata.

Um gateway **somente loopback** registra exclusivamente assets HTTPS oficiais e permite apenas ranges. Ele impõe orçamento agregado de bytes de corpo, rejeita respostas integrais/redirects inesperados e conserva proxy/TLS do ambiente. Não recebe URLs do navegador. Credenciais de autenticação/banco não são repassadas ao subprocesso.

Limites padrão por extração: 32 MiB de corpos, até 1.000 registros, DuckDB com 256 MiB e uma thread, prazo vinculado à consulta, saída máxima de 8 MiB. A memória inclui ainda o Python, buffers/JSON e Node; 256 MiB não é um teto de RAM do processo inteiro. Recortes grandes podem parar sem completar. O STAC imutável da release é cacheado em `.cache/overture`; dados não viram um download planetário. `OVERTURE_CACHE_DIR` pode apontar a um diretório gravável dedicado.

O modo online opcional precisa de Python/dependências no host. Para Render Free, prefira executar importações regionais numa máquina de desenvolvimento e manter apenas consultas PostGIS/Node no serviço; não pressuponha recursos suficientes para qualquer recorte Parquet no mesmo processo de hospedagem. Uma instância gratuita **separada de homologação** instalou essas ferramentas para validar recortes limitados; a produção não foi alterada.

Em plataformas que separam build e runtime, a extensão não pode ficar apenas no diretório pessoal da máquina de build. Configure `DUCKDB_EXTENSION_DIRECTORY=.duckdb-extensions` antes de executar `scripts/setup-discovery.py` e mantenha a mesma variável no runtime. Instalador e leitor resolvem esse caminho explicitamente; a pasta precisa estar dentro do artefato da aplicação. A extensão continua assinada, com TLS verificado e instalação explícita, sem download automático durante a consulta. O teste Python inclui troca do diretório pessoal entre build e runtime.

### Importação com checkpoint

Prepare `area.json` com `{ "place": <resultado geográfico completo>, "selection": { "countryCode": "DE", "cityName": "Cochem", "stateName": "Rhineland-Palatinate" } }`. O `place` precisa conter identidade OSM, `boundingbox`, `geojson` Polygon/MultiPolygon e país. Não substitua um município por um raio.

O extrator recebe por stdin um JSON com `bounds` na ordem **south,north,west,east**, `categories`, `maxBytes`, `maxRows` e `timeoutSeconds`; devolve envelope com `rows`, `metrics`, `truncated`, release e geometrias. Para importação offline, converta `rows` para NDJSON, um registro por linha:

```bash
npm run discovery -- import area.json overture-regional.ndjson overture
```

Máximo 32 MiB/10 mil linhas por arquivo. O checkpoint ao lado do NDJSON contém hash do arquivo e última linha confirmada; reexecutar o mesmo comando retoma. Alterar o arquivo invalida o checkpoint. O upsert por fonte/ID torna repetição após falha idempotente. Uma importação não marca a cidade como completamente coberta.

## Geofabrik/OSM regional

Escolha manualmente um extrato pequeno em https://download.geofabrik.de/ e confira tamanho/licença. Não baixe país/continente inteiro para uma pesquisa interativa.

```bash
.venv-discovery/bin/python scripts/geofabrik-region.py recorte.osm.pbf \
  --bounds=50.1196785,50.1793685,7.1080538,7.2125469 > comercios.ndjson
npm run discovery -- import area.json comercios.ndjson geofabrik
```

O leitor extrai nodes/ways nomeados, com contatos/endereço e sem metadados de contribuidores ou e-mails. O importador conserva somente segmentos suportados e o polígono completo faz o recorte final. Ways usam centro de bbox explicitamente aproximado; não uma entrada confirmada. Relações complexas em PBF ainda precisam de etapa de preparação externa. Limites padrão: PBF de até 128 MiB (máximo configurável 512 MiB), 5.000 registros, janela de 60 s e limite de espaço virtual de 1 GiB. Ao interromper, o stderr informa que o recorte foi parcial. Checkpoint de retomada é da importação NDJSON, não um offset interno do PBF.

## Fila e descoberta progressiva

```bash
npm run discovery -- enqueue area.json Restaurantes
npm run discovery -- worker 1
```

Não há daemon, cron ou varredura mundial habilitados. O operador prepara as áreas e inicia um número explícito de tarefas (1–5). O worker deixa de iniciar novas tarefas após 120 s; uma tarefa já iniciada pode consumir sua janela final de até 75 s. Concessões de 120 s, token de fencing, `SKIP LOCKED`, até três tentativas e checkpoint por fonte permitem retomada. Escrita de um trabalhador com token vencido é recusada. Etapas já concluídas com cobertura fresca não são consultadas novamente. Uma leitura Parquet interrompida não retoma no byte exato: o recorte daquela fonte é refeito sob o orçamento, preservando as etapas anteriores.

Cobertura completa com registros expira em sete dias; resposta válida vazia em uma hora; parcial/erro entra em espera de ao menos cinco minutos. `Retry-After` em segundos ou data é respeitado por fonte; não há rotação de IP/proxy nem repetição automática ilimitada. Falhas parciais mantêm os dados de outras fontes. Se nenhuma fonte conclui e não há registros locais, o sistema devolve erro explícito, não sucesso com lista vazia.

Orçamento conservador do catálogo: 50 mil registros, 64 MiB de relação/índices com estimativa adicional de crescimento, 16 KiB por payload. Não é armazenamento gratuito ilimitado nem um teto físico exato para todo o banco/WAL/backups. Atualizações/índices/autovacuum precisam de monitoramento. A fila recusa mais de 1.000 tarefas pendentes e remove tarefas finalizadas com mais de 30 dias; não há coleta contínua por país.

## Endpoints e compatibilidade

As buscas continuam usando `POST /api/search` e `GET /api/jobs/:id`. O job acrescenta métricas, fontes, aviso de cobertura parcial e ID da tarefa. Contas, CSRF, origem autorizada, limites de entrada, histórico e listas seguem os mecanismos existentes.

- `GET /api/discovery/capabilities`: modo/limites/fontes/licenças, protegido pela autenticação existente.
- `GET /api/discovery/tasks/:id`: estado/checkpoint exclusivamente para o dono da tarefa; outra conta recebe 404.

Não há endpoint público de importação, SQL ou varredura. Interface, globo, filtros, cards, progresso e exportação permanecem. CSV serializa proveniência/licença como JSON válido; JSON inclui licenças e cobertura parcial. Listas conservam atribuição e fontes cifradas. Nenhuma API do Google Maps é usada.

Vercel/Netlify continuam hospedando arquivos públicos e encaminhando API; o backend longo permanece no Render/Node. **Não mover o worker/importador para uma função de frontend.** As funções de proxy existentes não foram substituídas. Para habilitar em homologação, revise migração, crie banco isolado, teste e configure explicitamente as variáveis acima. Não foi feito merge ou deploy em produção.

## Limitações importantes

- Sem polígono municipal/distrital confirmado, o motor global pede correção/importação da área. Place-node, distrito sem limite e regiões que cruzam o antimeridiano não são inventados como municípios. O MVP recusa áreas maiores que 10° × 15°; não as corta silenciosamente.
- Consulta por bbox a QLever elimina a dependência do índice da relação, mas pode ser mais lenta. Mantém o limite de 500 candidatos; Overture também é limitada pelo orçamento. Cobertura total não é garantida.
- OSM de QLever/Overpass/Geofabrik é a mesma família de dados; suas contagens não são somadas como empresas independentes. Overture Places é a fonte independente revisada nesta release.
- Telefones e sites podem estar antigos. Formato válido, confiança de existência ou perfil publicado não comprovam WhatsApp, titularidade, funcionamento atual ou intenção de compra.
- `websiteClassification` distingue website identificado, aparentemente indisponível por HTTP observado, informação insuficiente, necessidade de verificação e website não identificado. A última categoria não significa inexistência de site. Prospect Score continua heurístico e não uma probabilidade de venda.
- Há testes de correção/indexação e métricas reais de amostra; não há teste com milhões de registros nem validação manual de cada negócio.

## Verificações executadas nesta entrega

- **336 testes Node passaram**, sem falhas ou skips, com PostgreSQL/PostGIS local real e URLs exclusivas de teste. Incluem a suíte anterior, geometrias, licenças, deduplicação, limites, leases, checkpoint e retomada.
- **7 testes Python passaram** com DuckDB/Parquet e PBF reais de fixtures fictícias; HTTP externo foi substituído por transporte controlado. Conferem ranges, orçamento, Point WKB, exclusão de campos desnecessários e rejeição de destino privado no catálogo.
- Chromium, computador e celular: busca autenticada → geocodificação controlada → dois provedores fictícios → PostGIS → cards → CSV → lista cifrada → recarga. Outra conta recebeu 404 para jobs/tarefas privados; o catálogo público foi reutilizado sem chamadas adicionais aos provedores. A regressão anterior de contatos também passou em ambos os formatos de tela.
- Auditoria de autenticação: **29 controles da ferramenta e 31 verificações HTTP** passaram, sem achados; apenas fixtures locais. A interface pública compilou com sucesso.
- A coleta real e seus limites estão em `GLOBAL_DISCOVERY_BENCHMARK.md`; testes fictícios não foram contabilizados como empresas reais. Um dump local das três tabelas públicas de validação foi preservado no workspace, separado de contas, sessões e tarefas; nenhuma base foi publicada automaticamente.

## Homologação posterior no Render

Resultados da API real, correções de gravação em lotes/build-runtime, configuração e limites do serviço gratuito separado estão em [GLOBAL_DISCOVERY_STAGING.md](GLOBAL_DISCOVERY_STAGING.md). A produção continua inalterada.
