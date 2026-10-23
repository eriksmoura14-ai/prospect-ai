# Homologação real no Render — 2026-10-23

A homologação foi executada em serviço **gratuito separado**, ligado à branch `codex/global-discovery-20261023`, sem merge na `main` ou alteração do serviço de produção. Nenhuma conta, senha, chave de e-mail ou dado privado da produção foi copiado. O projeto Neon também é novo, vazio e pertencente à organização gratuita existente.

- Serviço: https://prospect-global-staging-20261023.onrender.com
- Painel: https://dashboard.render.com/web/srv-dbdi4fbncjis73a9kes0
- Commit executado: `35f7c90a5ae2f2bffc45c245b1e9d1a9559f5733`.
- Deploy confirmado `live`: `dep-dbdiad1srm7s73brm9r0`.
- Render: Free, Oregon, 0,1 CPU/512 MB, deploy automático desligado.
- Neon: projeto dedicado `sweet-paper-26363335`, branch `staging`, PostgreSQL 17/PostGIS 3.5.7, compute limitado a 0,25 CU.
- Catálogo da rodada final: `prospect_staging_catalog_v2`, vazio antes do teste. O catálogo inicial de diagnóstico foi preservado separadamente, sem ser reutilizado na medição final.

A proteção deste serviço usa `AUTH_MODE=basic`, usuário `staging` e senha aleatória exclusiva em `APP_PASSWORD` no ambiente do Render. Não há senha no repositório nem na URL. Não utiliza as contas Gmail da produção, nem testa envio/recuperação de e-mail. O modo de contas e histórico cifrado permanece validado pela suíte separada com PostgreSQL real e pelos testes anteriores de navegador.

## Problemas encontrados e corrigidos

1. **Gravação com uma consulta de identidade e um upsert por registro.** Na primeira rodada pelo Render, os 473 registros de Berlim exigiram aproximadamente 60 s adicionais depois das respostas HTTP do QLever. A gravação agora consulta identidades existentes uma vez e insere lotes de até 100 registros na mesma transação. Preserva licença, orçamento, idempotência, último registro por identidade e invalidação de verificação quando contatos mudam. Na segunda rodada, o tempo adicional na etapa QLever ficou em aproximadamente 4 s. Essa diferença inclui normalização, recorte e persistência; não é uma medição isolada de SQL nem uma promessa de latência.
2. **Extensão DuckDB presente no build, ausente no runtime.** O instalador usava o diretório pessoal do build, que não integrava o artefato executado pelo Render. Instalador e leitor agora recebem explicitamente `DUCKDB_EXTENSION_DIRECTORY`, apontando para uma pasta da aplicação. A extensão continua assinada e a instalação usa HTTPS verificado. O teste automatizado troca o diretório pessoal para reproduzir a separação build/runtime.

A primeira rodada Render localizou as sete cidades, mas a Overture falhou por configuração de execução ou falta de tempo; seus resultados não foram confundidos com cobertura independente. A segunda rodada abaixo usa o código corrigido e outro catálogo vazio.

## Resultados da rodada final

Segmento fixo: **Restaurantes**. As sete pesquisas passaram pela API pública de homologação, com país, estado e cidade validados pelo mesmo backend da interface. Foram selecionados até dez cards por cidade; as métricas de descoberta abrangem todos os registros aceitos antes desse limite de exibição. Websites dos dez selecionados passam pela verificação limitada existente.

| Cidade | Antigo: únicos | Novo: antes → após deduplicação | Telefone publicado | Website publicado | Endereço | Localização válida | Descoberta / total servidor (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Berlin | 500 | 473 → 473 | 220 | 258 | 347 | 473 | 77.60 / 87.44 |
| Monschau | 39 | 87 → 82 | 64 | 55 | 68 | 82 | 30.26 / 37.51 |
| Cochem | 52 | 97 → 95 | 73 | 60 | 80 | 95 | 22.01 / 32.85 |
| Uberlândia | 175 | 1151 → 1149 | 894 | 476 | 993 | 1149 | 54.15 / 63.35 |
| Monte Carmelo | 13 | 57 → 57 | 42 | 18 | 47 | 57 | 26.96 / 29.57 |
| Toronto | 500 | 931 → 929 | 654 | 634 | 795 | 929 | 61.35 / 66.84 |
| Lunenburg | 7 | 26 → 26 | 22 | 20 | 21 | 26 | 17.06 / 21.79 |

A coluna antiga usa o commit e a rodada registrados em `GLOBAL_DISCOVERY_BENCHMARK.md`; não foi executada simultaneamente no mesmo host. Não é um ensaio controlado de velocidade. O código antigo não expunha contagem bruta antes da deduplicação; esse campo continua indisponível, sem reconstrução especulativa.

| Cidade | QLever: candidatos / aceitos | Overture: candidatos / aceitos | Limitação |
| --- | ---: | ---: | --- |
| Berlin | 500 / 473 | — | Limite QLever; Overture excedeu o prazo |
| Monschau | 49 / 39 | 64 / 48 | Nenhuma interrupção operacional observada |
| Cochem | 71 / 52 | 60 / 45 | Nenhuma interrupção operacional observada |
| Uberlândia | 186 / 175 | 1001 / 976 | Overture limitada a 1000 registros antes dos filtros |
| Monte Carmelo | 13 / 13 | 48 / 44 | Nenhuma interrupção operacional observada |
| Toronto | 500 / 398 | 1001 / 533 | Limites de candidatos nas duas fontes |
| Lunenburg | 7 / 7 | 19 / 19 | Nenhuma interrupção operacional observada |

Os candidatos Overture são do retângulo; apenas registros no polígono correto e com licença/esquema aprovados são aceitos. Um candidato extra detecta truncamento. Centroides de geometrias OSM podem ser aproximados e conservam essa indicação. Coordenadas válidas não comprovam uma entrada física ou empresa ativa. Telefones publicados não comprovam conta WhatsApp; website informado não comprova disponibilidade ou titularidade.

Taxa de falha completa: **0/7**. QLever entregou dados em **7/7** localidades; Overture entregou dados em **6/7**, com timeout em Berlim. Berlim, Toronto e Uberlândia permanecem explicitamente parciais. Uma rodada bem-sucedida não garante disponibilidade futura ou cobertura mundial, e não identifica a causa dos HTTP 503 observados anteriormente em outro local/horário.

## Persistência, interface e segurança do teste

O catálogo terminou com **2.822 registros de fontes**: 1.157 QLever e 1.665 Overture, em sete áreas. A apresentação combinada das sete cidades possui 2.811 registros após deduplicação conservadora. O banco final ocupava cerca de 23,9 MB no momento da consulta; isso não inclui todos os custos de histórico/backups ou uma projeção de crescimento.

No Chromium, desktop 1366×900 e celular 390×844 exibiram dez cards reais de Monschau, sem erro JavaScript ou overflow horizontal. CSV e JSON conservaram proveniência/atribuição. A API sem autenticação respondeu 401, e `/health` respondeu 200.

Uma nova pesquisa foi enviada **pelo formulário real**: Alemanha → Rhineland-Palatinate → Cochem → Restaurantes. Reutilizou 95 registros do catálogo, com `cacheHit: true`, sem novas chamadas aos provedores. Consulta/deduplicação do catálogo: **286 ms**; descoberta incluindo resolução/cache da área: **862 ms**; pesquisa completa no servidor: **1.476 ms**. A observação no navegador levou cerca de 2,1 s. É uma medição pontual, não SLA nem percentil de produção.

A amostragem de memória do Render, com intervalo de 60 s, registrou máximo observado de aproximadamente 184,5 MB em nove observações. Isso não é uma medição do pico instantâneo nem teste de carga. Nenhum serviço pago foi criado ou plano atualizado. As quotas gratuitas continuam aplicáveis: o Render compartilha 750 horas mensais entre instâncias gratuitas, pode suspender por limites e perde arquivos locais ao dormir; o Neon aplica os limites do plano gratuito. O catálogo é persistido no Neon, não no disco efêmero do Render.

## Configuração reproduzível

A configuração atual foi criada via MCP/ambiente do serviço, sem Blueprint sincronizado. Conservar `autoDeploy: no` e a branch de teste.

Build:

```sh
npm ci && python3 -m venv .venv-discovery && .venv-discovery/bin/python -m pip install --disable-pip-version-check duckdb==1.4.4 requests==2.32.5 && .venv-discovery/bin/python scripts/setup-discovery.py
```

Startup: `npm start`. Variáveis não sensíveis:

```text
NODE_ENV=production
NODE_VERSION=22.22.0
APP_HOSTED=true
AUTH_MODE=basic
APP_USER=staging
DISCOVERY_ENGINE=global
DISCOVERY_SOURCES=qlever,overture
OVERTURE_PYTHON=.venv-discovery/bin/python
DUCKDB_EXTENSION_DIRECTORY=.duckdb-extensions
```

`APP_PASSWORD` e `DISCOVERY_DATABASE_URL` são exclusivos da homologação e ficam nas variáveis privadas do serviço. A URL pública é obtida de `RENDER_EXTERNAL_URL`. A migração `db/discovery.sql` foi executada explicitamente no banco vazio antes do startup. Não habilitar esse catálogo ou copiar a proteção Basic para a produção automaticamente. O serviço gratuito pode demorar para acordar após inatividade.

Validação após as correções: **336 testes Node**, sem falhas/skips, com bancos locais descartáveis; **7 testes Python**, incluindo troca de diretório de execução; ambos os workflows GitHub aprovados no commit executado. Dados agregados, tempos completos e falhas por fonte: `reports/global-discovery-render-20261023.json`. Os registros comerciais completos, senhas e geometrias não são publicados neste relatório.
