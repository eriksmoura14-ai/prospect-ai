# Cobertura do Prospect AI — 26/10/2026

A meta é **50 empresas reais e únicas para cada uma das 152.970 opções de
localidade do aplicativo**, somando os 24 segmentos atuais. **A meta mundial
continua incompleta: 7.075 localidades atingiram 50 (4,6251%) e 145.895 ainda
estão abaixo ou sem confirmação.** O inventário inclui localidades/territórios,
não apenas municípios; nomes semelhantes não autorizam usar cidades vizinhas.

## Acervo preservado e ampliado

| Medida | Antes desta expansão | Final |
|---|---:|---:|
| Empresas após deduplicação conservadora | 2.217.908 | 3.407.823 |
| Observações das fontes | 2.222.478 | 3.415.551 |
| Observações sobrepostas identificadas | 4.570 | 7.728 |
| Localidades com pelo menos 50 | 4.592 | 7.075 |

Foram acrescentadas **1.189.915 empresas únicas** em cinco lotes. Há registros
em 27 países; isso não significa cobertura completa desses países. O milhão
original continua byte a byte igual, SHA-256
`f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`.
Arquivos, origens e IDs anteriores foram preservados.

O arquivo principal contém 3.395.357 registros canônicos; a base pública legada
continua com 13.954 observações, correspondentes a 12.467 empresas isoladamente.
Uma já estava no arquivo canadense: são 12.466 empresas adicionais ao arquivo,
sem contar essa sobreposição duas vezes. A identidade canônica anterior foi
preservada. As cópias regionais de consulta acrescentam **zero** empresas.

## Todas as localidades continuam no denominador

| Situação | Localidades | Fração de todas as 152.970 |
|---|---:|---:|
| Pelo menos 50 | 7.075 | 4,6251% |
| Pelo menos 100 | 4.136 | 2,7038% |
| Pelo menos 200 | 2.158 | 1,4107% |
| Alguma empresa com associação confirmada | 28.288 | 18,4925% |

Os limiares são cumulativos. Há 24.987 localidades com coleta parcial, 120.906
com localização ainda pendente e duas com falha temporária. Nenhuma foi marcada
como fonte esgotada apenas porque um lote Overture terminou. O CSV completo no
pacote contém **as 152.970 localidades**, incluindo contagens desconhecidas,
fontes efetivamente consultadas, limitações e próxima ação.

| País com cruzamento geográfico processado | Localidades do aplicativo | ≥50 | ≥100 | ≥200 |
|---|---:|---:|---:|---:|
| US | 16731 | 4336 | 2473 | 1219 |
| CA | 1080 | 256 | 154 | 86 |
| BR | 5629 | 1018 | 623 | 355 |
| MX | 9321 | 561 | 363 | 230 |
| CO | 1122 | 137 | 75 | 50 |
| GT | 382 | 36 | 17 | 4 |
| ES | 8405 | 731 | 431 | 214 |

Outros países preservam seus dados anteriores, mas não receberam uma falsa
confirmação municipal. México e Espanha, por exemplo, ainda têm localidades
sem correspondência inequívoca de nome, estado e âncora geográfica. Não foram
preenchidas com empresas do município vizinho. Vinte e seis aliases US/CA e
22 aliases espanhóis compartilham limites; são opções reais da lista, não
empresas globais adicionais.

## Qualidade dos novos lotes

| País | Novas únicas | Telefone publicado | URL pública | Endereço | Coordenadas válidas |
|---|---:|---:|---:|---:|---:|
| BR | 455197 | 406340 | 171445 | 442914 | 455197 |
| MX | 396290 | 343517 | 85320 | 378358 | 396290 |
| CO | 62098 | 54329 | 22696 | 58564 | 62098 |
| GT | 10136 | 8135 | 2477 | 9289 | 10136 |
| ES | 266194 | 239423 | 111493 | 262027 | 266194 |

URL pública pode ser perfil social ou endereço ainda não verificado; telefone
publicado não confirma WhatsApp. Ausência desses campos não prova ausência de
site ou contato. Coletada também não significa aberta agora ou verificada.
Os critérios conservadores podem reter duplicatas incertas; não se fundem
negócios diferentes só pelo nome. OSM via QLever, Overpass e Geofabrik mantém
identidade compartilhada. Aliases e proveniência estão no pacote.

A conciliação/gravação local dos cinco lotes levou, respectivamente, 25,895 s,
18,648 s, 4,576 s, 1,732 s e 14,642 s. Esses tempos **não** incluem download,
normalização, revisão ou publicação e não representam a duração total da tarefa.
Os checkpoints e relatórios por região registram essas etapas separadamente.

## Busca funcional e custo

O backend filtra arquivos por sobreposição geográfica antes do limite de oito
arquivos por busca. Foram comparados todos os campos dos 3.129.163 registros
reorganizados, com contagens e agregados inteiros de hashes, preservando os
SHA-256 dos originais. Os 187 novos arquivos de consulta usam 425.456.629 bytes;
não representam crescimento do número de empresas. O lote espanhol ocupa mais
33.390.279 bytes. O banco operacional usava aproximadamente 223,5 MB na auditoria,
abaixo do limite operacional de 220 MiB (230.686.720 bytes). Verificar novamente
antes de continuar; arquivos originais e outros produtos também ocupam espaço.

Em Nova York, o conjunto selecionado caiu de 310,7 MB para 17,8 MB; em Bocaiúva,
de 54,5 MB para 3,27 MB. É redução dos bytes selecionados em uma consulta fria,
não promessa de redução proporcional de latência. O cache continua em 512 MiB.

A conta permanece Free e nenhuma cobrança foi habilitada. A quota de transferência
que estava configurada em 1 GiB foi corrigida para 5.000.000.000 bytes, dentro dos
5 GB mensais gratuitos documentados. Outras quotas e o limite operacional não
foram aumentados. Franquia gratuita não é capacidade ilimitada.

## Verificação real

O staging isolado usa o mesmo leitor de catálogo de produção. La Roda, Espanha,
retornou **51 empresas únicas** entre todos os segmentos: 49 com telefone, 24
com URL e 51 com endereço. A busca normal retornou dez linhas, descobriu 22
restaurantes e confirmou `archive:true`, em 9,721 s. A conferência dos 24
segmentos levou 121,868 s; esses tempos medem operações diferentes.

Depois da troca dos arquivos, as páginas reais de Gananoque/CA, Brazil/US,
Bocaiúva/BR e Tlahuapan/MX retornaram HTTP 200, em cerca de 4,0–6,2 s. Duas
páginas de Gananoque não repetiram empresas. Saúde de produção: HTTP 200;
catálogo sem autenticação: HTTP 401. Nenhuma sessão privada de cliente foi usada.

Validação de código: 317 testes Node aprovados; dois testes locais exigiam banco
isolado. O CI executou autenticação e PostGIS com sucesso. Dezoito testes Python
de catálogo passaram. Upload que falhou temporariamente foi retomado; os
187 arquivos terminaram publicados, com SHA-256 local e leitura pública
confirmados. Os 50 blocos geográficos espanhóis também tiveram SHA-256 remoto
confirmado. O leitor confere o SHA-256 dos Parquets usados em cada consulta. Não há medição que permita afirmar uma taxa mundial de erro zero.

Código de consulta publicado pelo [PR 35](https://github.com/eriksmoura14-ai/prospect-ai/pull/35),
commit de produção `81dd189d8faf3cefbd99877bf2a0c70caf228a60`.

## Evidências e retomada

[Baixar dados adicionais e inventário completo](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261026/city-coverage-expansion-v2.zip).
O pacote contém cinco Parquets incrementais, todos os estados do inventário,
metadados/licenças, crosswalks, aliases, checkpoints públicos e resultados reais.
Credenciais, tokens e URLs assinadas foram excluídos por lista explícita de arquivos.
O milhão e as expansões anteriores permanecem nos arquivos e pacotes originais.

O inventário exportado e seus derivados são oferecidos sob ODbL 1.0, com
atribuição à Countries States Cities Database e às fontes geográficas descritas
em [CATALOG_ATTRIBUTIONS.md](CATALOG_ATTRIBUTIONS.md). Os Parquets comerciais
independentes conservam suas licenças e proveniência originais.

A fila persistente tem 24.989 tarefas de complemento na primeira rodada, além
 das revisões geográficas pendentes. **Não há varredura mundial em segundo plano.**
O próximo trabalho é revisar os limites das localidades pendentes e complementar
as menores com fontes regionais permitidas. Fontes distritais da Alemanha e
França não foram aceitas como se fossem limites municipais gerais.

Com os arquivos operacionais privados já configurados, os comandos exatos abaixo
refazem a auditoria completa, priorizam as localidades abaixo de 50 e repetem o
teste do aplicativo sem repetir downloads. Eles não executam uma coleta mundial:

```sh
cat .env.coverage-operations | .artifacts/venv-catalog/bin/python scripts/catalog-coverage-audit.py --root .artifacts/catalog-audit-20261026
cat .env.coverage-operations | .artifacts/venv-catalog/bin/python scripts/catalog-ops.py queue
cat .env.catalog-smoke | .artifacts/venv-catalog/bin/python scripts/catalog-smoke.py --root .artifacts/city-coverage-europe-20261026 --country ES --state AB --city-id 152270 --niches .artifacts/coverage-20261023/niches.json --expected-unique 51 --normal-search
```

A retomada da coleta por país, com `boundaries`, `catalog-region.py`, `reconcile`
e publicação em lotes está em [CITY_COVERAGE_RUNBOOK.md](CITY_COVERAGE_RUNBOOK.md).
País novo exige revisão real de hierarquia, licença e orçamento; não basta trocar
um código para fingir que qualquer ADM2 é um município. Os dados já publicados
continuam atendendo buscas enquanto essa revisão avança.
