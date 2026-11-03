# Prospect AI: acervo mundial e cobertura real — 3/11/2026

A rodada foi publicada no catálogo durável e testada no backend de homologação existente. **A meta de 50 empresas em todas as localidades ainda não foi atingida.** Main permanece em `7cf5faea13d07b8ca94a39681e5df075721ecd43`; as alterações de código estão na branch de auditoria/PR 38.

## Acervo preservado e expansão

| Medida | Antes | Agora |
|---|---:|---:|
| Linhas canônicas ativas em Parquet | 5.680.824 | 9.110.079 |
| Observações de fonte no legado | 13.960 | 13.960 |
| Únicas adicionais conservadoras do legado | 12.466 | 12.466 |
| Identidades comerciais após deduplicação conservadora | 5.693.290 | 9.122.545 |

São **3.429.255 novas identidades** em 197 países/territórios; o acervo combinado alcança 214. Os 302 arquivos novos contêm 5.206.501 linhas, incluindo 1.777.246 linhas antigas reorganizadas para preservar o limite de arquivos por busca. Essas cópias não foram contadas como empresas novas. Os 115 metadados antigos de atendimento substituídos ficaram aposentados, e os objetos/IDs/campos originais continuam preservados. Existem 481 ativos canônicos prontos.

O arquivo original de cerca de um milhão continua com 137.403.018 bytes e SHA-256 `f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`. Os 294 metadados originais e seus objetos foram conferidos; os 20.954 polígonos nativos permanecem. Os 556.068 registros originais de outros setores foram preservados e excluídos da meta dos 24 segmentos.

Os totais são resultados das regras de identidade, não certificação de cada empresa física. Há 12.144 aliases entre fontes identificados na fase inicial, preservados no checkpoint; o total final de aliases após a confirmação costeira não foi recontado independentemente. OSM via QLever/Overpass/Geofabrik mantém a mesma família de identidade. Sobreposições não identificadas ainda podem existir.

## Cobertura sobre o inventário inteiro

| Meta | Localidades | Percentual das 152.970 |
|---|---:|---:|
| Pelo menos 50 | 15,437 | 10.091521% |
| Pelo menos 100 | 8,575 | 5.605674% |
| Pelo menos 200 | 4,199 | 2.744983% |

Há 71.816 opções com ao menos uma empresa confirmada e 85.360 com contagem geográfica disponível, em 125 países com empresas associadas. Foram acrescentados 13.555 vínculos geográficos e 2.514 opções atingiram 50. Os totais locais não são somáveis: o inventário contém opções administrativas sobrepostas.

**Restam 137.533 opções abaixo da meta ou pendentes:** 69.923 com contagem de 0–49 nas fontes processadas e 67.610 sem associação geográfica confirmada. As limitações por local e a próxima ação estão no CSV completo e no banco. Uma fonte concluída não é um censo, e zero registros não comprova ausência de empresas. Os fingerprints de todas as 152.970 chaves e contagens, nos 223 países, corresponderam ao banco.

## Testes reais

As quatro consultas abaixo retornavam HTTP 409 por limite pendente. Depois da ativação, todos os 24 segmentos foram consultados com sucesso em cada uma:

| Local | Cobertura conservadora no inventário | IDs distintos retornados pela API | Telefone publicado | URL publicada | Endereço |
|---|---:|---:|---:|---:|---:|
| Armidale | 117 | 117 | 112 | 86 | 117 |
| Aquiraz | 175 | 176 | 158 | 63 | 171 |
| White Rock | 128 | 129 | 126 | 109 | 127 |
| Avanos | 109 | 109 | 90 | 30 | 97 |

Aquiraz e White Rock apresentam diferença de uma unidade entre a contagem local conservadora e os IDs do atendimento. Não aumentamos a meta para igualar os números; a reconciliação está registrada. Em Aquiraz, a deduplicação do runtime também retornou 176, portanto essa diferença não foi declarada resolvida. Telefones/URLs continuam não verificados.

Armidale e Avanos também passaram pela pesquisa normal: dez cards em cada uma, `archive:true`, utilizando ativos `world-v1-*`; 44 e 66 restaurantes descobertos, respectivamente. Os tempos totais dos jobs foram 12,786 s e 9,007 s, incluindo verificação de websites. O teste agregado de 24 segmentos dura mais que uma pesquisa comum.

| Pesquisa normal — restaurantes | Antes | Depois | Telefone | URL | Endereço | Coordenadas válidas | Descoberta depois (s) | Catálogo |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Berlin | 723 | 723 | 433 | 438 | 596 | 723 | 13.107 | True |
| Monschau | 82 | 82 | 64 | 55 | 68 | 82 | 6.901 | True |
| Cochem | 177 | 177 | 149 | 114 | 162 | 177 | 7.701 | True |
| Uberlândia | 1196 | 1196 | 936 | 497 | 1039 | 1196 | 7.779 | True |
| Tiradentes | 127 | 127 | 97 | 45 | 100 | 127 | 4.318 | True |
| Toronto | 1179 | 1179 | 888 | 855 | 1043 | 1179 | 9.368 | True |
| Banff | 90 | 90 | 87 | 88 | 89 | 90 | 4.797 | True |

Sete comparações normais e duas buscas novas terminaram sem erro, com dez cards cada. Tiradentes passou de 38,121 s para 4,318 s na etapa de descoberta, mantendo 127 resultados e passando a reutilizar o catálogo. Outros tempos aumentaram em leituras frias; não há alegação de aceleração universal. Houve um diagnóstico concorrente com HTTP 503 por leitor ocupado; a instância gratuita continua limitada a um leitor de arquivo por vez. As verificações de cidades foram sequenciais.

## Qualidade, tempo e recursos

O lote novo tem 2.834.118 registros com telefone publicado, 1.297.986 com URL publicada, 3.192.946 com endereço e 3.429.255 com coordenadas válidas. URLs podem incluir perfis sociais classificados separadamente. Não há prova automática de WhatsApp, atividade atual ou ausência de website.

A fonte Overture foi lida em 16 partições, uma vez por checkpoint, com projeção de colunas e seleção comercial. A etapa de origem registrou 3.216.524 ms e geografia/atendimento 1.196.858 ms: aproximadamente 777 novas identidades/s no tempo medido desses workers, excluindo filas, repetições e publicação. Não houve geocodificação sistemática no Nominatim.

Foram publicados 650.212.997 bytes comerciais e 93.449.498 bytes de geografia gzip (326.992.747 bytes decodificados), com SHA-256 remoto integral. Antes do pacote final de evidências, o bucket tinha **3.107 objetos e 3.803.470.455 bytes**, dentro de 5.000.000.000 bytes. O banco media 216.154.112 bytes no audit, abaixo do guard de 220 MiB. A última leitura do contador publicado do provedor indicou 3.937.494.358 bytes de transferência e 3.556 segundos de compute; o contador pode atrasar. O teto conservador reservado era 4.557.255.871 bytes antes do pacote final, com 50 MiB reservados ao aplicativo. Nenhuma quota foi elevada ou cobrança habilitada.

Passaram 161 testes Python, 16 testes Node específicos de arquivo/geometria e CI geoespacial/PostGIS e de autenticação. Os textos de licença e as atribuições acompanham o pacote público.

## Persistência e continuação

Os dados comerciais e geográficos estão no bucket existente, com metadados PostgreSQL/PostGIS em `catalog_ops`; o legado continua em `prospect_catalog`. O backend consulta metadados por país e limites, lê arquivos limitados e pagina resultados; não envia o acervo inteiro ao navegador. A fila persistente tem 50.000 tarefas de cidade prontas, 785 concluídas e 223 revisões geográficas bloqueadas; as demais pendências continuam no inventário completo, sem duplicar tarefas sem limite. Não há coletor mundial contínuo nem execução agendada.

Para auditar o estado atual e renovar o próximo lote da fila, a partir deste checkout e do seletor privado existente:

```sh
.artifacts/venv-catalog/bin/python scripts/catalog-world-activate.py audit --root .artifacts/world-ingest-20261103/final --database-config .env.coverage-operations
.artifacts/venv-catalog/bin/python scripts/catalog-ops.py queue < .env.coverage-operations
```

Esses comandos auditam/renovam a fila; não equivalem a coletar novas empresas. A retomada dos arquivos e checkpoints está em [WORLD_INGEST_RUNBOOK.md](WORLD_INGEST_RUNBOOK.md). Repetir uma partição concluída não criará nova cobertura: as próximas rodadas exigem limites licenciados compatíveis e fontes complementares para as pendências, respeitando o orçamento remanescente. Não é possível garantir 50 negócios reais em todo distrito ou povoado.

[Dados e checkpoints completos](https://github.com/eriksmoura14-ai/prospect-ai/releases/tag/catalog-geography-41661789699) · [Evidências verificáveis](evidence/catalog-world-publication-20261103.json) · [PR 38](https://github.com/eriksmoura14-ai/prospect-ai/pull/38).

Pacote público final: [3702496 bytes](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261103/world-discovery-7cc13ac8f4c23eea.zip), SHA-256 `7cc13ac8f4c23eead69d3663d63bf8e187a28d70cf9a98c1ca6a07b96e919a7d`. Após sua publicação, a listagem confirmou **3.108 objetos e 3.807.172.951 bytes** no bucket. O último audit do banco registrou 216.596.480 bytes. O teto conservador após reservar o upload e a leitura integral das evidências é 4.564.660.863 bytes, mantendo 50 MiB para o aplicativo e a quota de 5 GB.

Berlim e Toronto continuam com cruzamento automático pendente no inventário, embora suas pesquisas interativas tenham encontrado 723 e 1.179 restaurantes. Não promovemos uma contagem geográfica sem um vínculo revisado.
