# Expansão acelerada — 27/10/2026

Snapshot conferido em **2026-10-27T13:57:05.86119+00:00**. O código de produção permanece em main; esta implementação está na branch separada do PR 38. As consultas abaixo foram executadas no serviço de teste existente, sem novo deploy de produção.

## Resultado verificável

| Métrica | Antes desta rodada | Depois |
| --- | ---: | ---: |
| Empresas únicas conservadoras | 4.979.881 | **5.517.669** |
| Observações das fontes, incluindo sobreposições | 4.990.876 | 5.530.174 |
| Sobreposições identificadas | 10.995 | 12.505 |
| Localidades com pelo menos 50 | 12.131 | **12.639** |

Foram incorporadas **537.788 empresas únicas**, a partir de 539.298 observações novas; 1.510 sobreposições adicionais foram identificadas. O total contém 5.505.203 registros canônicos nos arquivos ativos e 12.466 empresas adicionais do legado. Cópias para distribuição espacial e arquivos originais aposentados são preservados e não contam como empresas novas. O legado público permanece com 13.960 observações.

O catálogo contém registros em **42 países/territórios**; os arquivos canônicos ativos cobrem 29 deles. A diferença vem do legado. A tabela por país distingue registros canônicos de observações legadas, que não devem ser somadas como empresas únicas.

| País | Novas únicas | Únicas no país, com legado | Localidades no aplicativo | Pelo menos 50 / 100 / 200 |
| --- | ---: | ---: | ---: | ---: |
| GB | 354.577 | 354.712 | 3.879 | 251 / 124 / 50 |
| FI | 26.794 | 27.038 | 437 | 92 / 52 / 24 |
| DK | 28.439 | 28.439 | 430 | 90 / 78 / 49 |
| SE | 48.317 | 48.317 | 800 | 7 / 5 / 3 |
| NO | 18.343 | 18.343 | 666 | 1 / 0 / 0 |
| AR | 56.737 | 57.043 | 1.136 | 56 / 34 / 14 |
| UY | 4.581 | 4.581 | 2.010 | 11 / 6 / 1 |

O milhão original conserva 137.403.018 bytes e SHA-256 `f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`, novamente conferido nesta rodada. Contatos e websites são publicados pelas fontes e continuam não verificados.

## Cobertura sobre todo o inventário

O denominador continua sendo **152.970 localidades**, presentes em 223 países/territórios da lista. O menu geral tem 250 países, incluindo opções sem localidades enumeradas. Empresas acima das metas foram preservadas.

- Pelo menos 50: **12.639 (8,2624%)**, aumento de 508 localidades nesta rodada.
- Pelo menos 100: **6.719 (4,3924%)**.
- Pelo menos 200: **3.186 (2,0828%)**.
- Com algum registro associado e confirmado: 61.739.
- Localização pendente: 82.743; coleta parcial abaixo de 50: 57.586; falha temporária: 2.

**Ainda há 140.331 localidades abaixo de 50 ou sem confirmação suficiente. A meta mundial não está concluída.** As três exceções francesas auditadas continuam abaixo da meta, sem serem removidas do denominador. Uma resposta completa de uma fonte não significa cobertura completa da cidade.

A auditoria incremental reconstruiu o inventário inteiro a partir do último export completo e dos países atualizados. Os fingerprints de todas as chaves, contagens, quantidade de segmentos e estados foram comparados contra o PostgreSQL de cada um dos 223 países. O export não depende somente das cidades processadas; cada país precisa concordar para a auditoria passar. Datas de atualização individuais dos registros alterados não foram retransmitidas e ficam nulas no espelho incremental; o snapshot tem seu próprio horário de conferência.

## O que acelerou e corrigiu a descoberta

1. Lotes regionais reutilizados: Dinamarca, Finlândia, Noruega e Suécia foram normalizadas em uma leitura do mesmo arquivo. Argentina e Uruguai também compartilharam uma leitura. Nenhum novo arquivo bruto Overture Places foi baixado nesta rodada. Houve transferências de geometrias, publicação e verificação dos dados.
2. Os 104 manifestos britânicos passaram a usar três lotes de escrita, mantendo validação integral, limites por lote, idempotência e checagem de espaço. Isso reduz 208 operações de banco para seis, considerando a conferência de espaço de cada lote.
3. Os 354.577 registros britânicos foram distribuídos em 63 fragmentos geográficos. Todos os campos foram comparados com o arquivo original; isso acrescentou zero empresas. O backend consulta apenas arquivos que interceptam a área, dentro do limite existente de oito.
4. O mapa de países Natural Earth 1:10m descartava pontos costeiros apesar de existirem dentro de áreas locais publicadas. A recuperação exige país concordante e contenção exata em um polígono previamente revisado, sem buffer ou cidade vizinha. Foram recuperadas **2.492 empresas únicas** nos seis deltas costeiros; os demais 92 candidatos aceitos na geografia eram sobreposições. Os dados e suas provas derivadas são disponibilizados sob ODbL e mantêm as licenças originais dos registros.
5. Na Argentina, `locality` e `localadmin` homônimos geravam ambiguidades. A definição publicada pela Overture permite selecionar uma única localidade povoada quando ela estiver inteiramente contida nas administrações homônimas. Foram resolvidos 287 casos, mantendo os 224 vínculos anteriores. Permanecem 108 ambiguidades e outras 517 localizações não confirmadas. A escolha não depende da quantidade de empresas.
6. Na Dinamarca, 91 opções explicitamente nomeadas como `Kommune` foram vinculadas a municípios, após revisão da hierarquia de 98 municípios em cinco regiões. Essa regra não transforma uma cidade comum em município nem muda o inventário.
7. O índice de linhas por país permite extrair apenas grupos físicos relevantes de Parquet. Na Argentina, seis grupos somaram 2.920 áreas e cerca de 42,9 MB de transferência; dois grupos grandes continuaram pendentes. Os limites de 32 MiB por range e 128 MiB por leitura foram mantidos.

A definição de escopos vem de https://docs.overturemaps.org/schema/reference/divisions/types/division_subtype/ . A hierarquia dinamarquesa foi conferida em https://www.dst.dk/en/Statistik/dokumentation/nomenklaturer/nuts . As licenças e atribuições completas estão em [CATALOG_ATTRIBUTIONS.md](CATALOG_ATTRIBUTIONS.md).

## Consultas reais usando os dados novos

Cada consulta percorreu os 24 segmentos. Quatro delas compararam o conjunto de IDs com os ativos locais verificados. Ærø, Hamina, Victoria e Las Piedras tiveram igualdade exata de SHA-256 do conjunto de IDs. Abertillery confirmou a contagem de 50. A pesquisa normal retornou dez cards e comprovou uso do arquivo persistente.

| Localidade | Únicas na API | Telefone publicado | Website informado | Endereço | Descoberta | Pesquisa normal completa |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Abertillery (GB) | 50 | 46 | 19 | 50 | 4.011 s | 9.012 s |
| Ærø Kommune (DK) | 59 | 52 | 37 | 59 | 4.301 s | 6.907 s |
| Hamina (FI) | 104 | 93 | 63 | 103 | 3.508 s | 8.357 s |
| Victoria (AR) | 50 | 48 | 13 | 50 | 5.107 s | 27.115 s |
| Las Piedras (UY) | 53 | 45 | 13 | 48 | 3.186 s | 12.093 s |

A pesquisa completa também verifica websites; por isso seu tempo pode exceder o tempo de descoberta. O teste de todos os segmentos foi sequencial, respeitando o leitor único e os limites do backend. Telefone publicado não confirma conta de WhatsApp; URL ausente não comprova ausência de website.

## Desempenho e capacidade observados

- Quatro países nórdicos: 120.132 registros normalizados em 79,873 s, aproximadamente 1.504 registros/s, antes da deduplicação comercial.
- Argentina/Uruguai: 61.451 em 47,567 s, aproximadamente 1.292 registros/s, antes da deduplicação.
- Banco de operações: **229.539.840 bytes**, com guard de 230.686.720 bytes (220 MiB); limite efetivo do projeto de 268.435.456 bytes.
- Armazenamento de objetos antes deste pacote: **1.280 objetos, 2.934.725.634 bytes**, incluindo originais preservados e cópias de distribuição.
- Foram liberados 143.679.488 bytes somente de dois bancos locais derivados de distribuição, após comparação de todos os campos com os Parquets preservados. Nenhum arquivo comercial canônico nem o milhão original foi apagado.
- O último contador de transferência retornado pelo projeto indicava 4.885.295.531 de 5.000.000.000 bytes; ele pode atualizar com atraso. A expansão seguinte precisa conferir novamente cotas e espaço, mantendo margem para consultas do aplicativo. Não houve contratação de serviço pago ou aumento de cotas.

Os tempos são medições destas etapas e consultas, não promessa de disponibilidade mundial ou de tempo máximo para todas as pesquisas.

## Retomada

Os resultados estão no armazenamento durável e registrados no catálogo consultado pelo backend. A fila e o inventário persistidos permanecem disponíveis; **não existe um coletor mundial continuamente ativo**. Não há processo prometido para continuar depois desta tarefa.

O comando de auditoria foi salvo em `scripts/catalog-audit-incremental.py`; o pacote contém a prova SQL e os exports completos. A fila só materializa lotes pequenos sob o limite de 50 mil tarefas ativas. [CITY_COVERAGE_RUNBOOK.md](CITY_COVERAGE_RUNBOOK.md) documenta publicação, retomada, recuperação costeira e comparação dos IDs na API.

Para reutilizar o próximo conjunto de arquivos já existentes, Portugal pode começar pelas duas partições abaixo, sem baixar a mesma região por cidade ou segmento:

```bash
.artifacts/venv-catalog/bin/python scripts/catalog-region.py --region .artifacts/coverage-20261023/region-00005 --baseline .artifacts/catalog-million-20261023/prospect-businesses.parquet --countries .artifacts/catalog-million-20261023/countries-natural-earth.geojson --niches .artifacts/coverage-20261023/niches.json --country-code PT
.artifacts/venv-catalog/bin/python scripts/catalog-region.py --region .artifacts/coverage-20261023/region-00006 --baseline .artifacts/catalog-million-20261023/prospect-businesses.parquet --countries .artifacts/catalog-million-20261023/countries-natural-earth.geojson --niches .artifacts/coverage-20261023/niches.json --country-code PT
```

Antes desses comandos, verificar cotas, integridade e os caminhos atuais do cache no plano de fontes. Depois, revisar a geografia portuguesa, conciliar com o legado e os ativos existentes, publicar com checkpoints e testar uma cidade pequena. Esses comandos não iniciam uma varredura mundial nem garantem 50 empresas onde não houver dados suficientes.

## Validação do código

**90 testes Python passaram**, incluindo países homônimos, buracos em polígonos, preservação de escopos, deduplicação, limites de transporte, recuperação costeira e auditoria de todo o inventário. As suítes reais de autenticação e geoespacial/PostGIS do commit `07d7feb5d7dc463af6bdc51b5dedff8dca4b0dda` também passaram no GitHub. Main, interface, login, exportações, histórico e código de produção não foram alterados nesta rodada.

## Evidências persistentes

[Baixar inventário completo, provas e relatórios](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261027/coverage-accelerated-v2.zip). O pacote mantém a lista completa de 152.970 localidades, métricas por país, consultas reais, checkpoints públicos e hashes dos ativos; os arquivos comerciais permanecem nos objetos originais referenciados.
