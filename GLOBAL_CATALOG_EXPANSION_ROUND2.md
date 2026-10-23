# Segunda rodada de expansão do catálogo — 23/10/2026

Coleta finita e importação aditiva no mesmo catálogo público do Prospect AI. Nenhum código da aplicação em produção, credencial de autenticação, histórico privado, configuração do Render ou plano foi alterado. Não foi habilitada coleta contínua.

## Resultado conferido no banco

| Métrica | Antes desta rodada | Depois |
|---|---:|---:|
| Registros das fontes | 6100 | 9687 |
| Cadastros únicos por deduplicação conservadora | 6088 | 9667 |
| Cidades com registros | 27 | 56 |
| Países | 17 | 24 |
| Cidades com pelo menos 50 cadastros | 24 | 52 |

Foram importados **3587 registros novos das fontes**, correspondentes a **3579 cadastros únicos adicionais**, em **29 cidades novas**. O catálogo continua cobrindo seis continentes. Agora contém 4699 cadastros únicos com telefone público, 3474 com website informado e 6011 com endereço. A meta de 50 soma os 24 nichos suportados; não significa 50 por nicho.

Todos os 9.687 identificadores persistidos conferem com o conjunto esperado. O PostGIS confirmou localização válida e pertença a pelo menos uma área revisada do mesmo país para todos os registros; encontrou zero registros fora dessas áreas e zero registros sem a proveniência exigida. A base ocupa cerca de 43,4 MB; tabela/índices de registros, 21,0 MB, abaixo dos limites operacionais atuais.

## Cidades novas nesta rodada

| País | Município/área administrativa | Únicos | Com telefone | Com website | Meta 50 |
|---|---|---:|---:|---:|---|
| AU | City of Hobart | 150 | 41 | 41 | Sim |
| AU | City of Launceston | 150 | 5 | 27 | Sim |
| BR | Arraial do Cabo | 63 | 7 | 3 | Sim |
| BR | Bonito | 17 | 10 | 2 | Pendente |
| BR | Olinda | 92 | 28 | 12 | Sim |
| BR | Ouro Preto | 111 | 14 | 5 | Sim |
| BR | Paraty | 150 | 6 | 6 | Sim |
| BR | Pirenópolis | 57 | 6 | 4 | Sim |
| BR | São João del Rei | 50 | 1 | 0 | Sim |
| CA | Banff | 118 | 84 | 88 | Sim |
| CA | Niagara-on-the-Lake | 81 | 10 | 17 | Sim |
| CL | Puerto Varas | 150 | 17 | 11 | Sim |
| CO | Medellín | 150 | 13 | 14 | Sim |
| CO | Villa de Leyva | 150 | 7 | 4 | Sim |
| DE | Quedlinburg | 117 | 68 | 57 | Sim |
| ES | Ronda | 149 | 16 | 12 | Sim |
| FR | Colmar | 150 | 37 | 32 | Sim |
| GB | Stratford-upon-Avon | 135 | 27 | 80 | Sim |
| ID | Yogyakarta | 149 | 27 | 14 | Sim |
| IT | Assisi | 137 | 32 | 20 | Sim |
| JP | Kamakura | 150 | 6 | 3 | Sim |
| JP | Kanazawa | 150 | 32 | 33 | Sim |
| MA | Essaouira | 150 | 16 | 7 | Sim |
| NZ | Napier | 149 | 40 | 53 | Sim |
| PH | Baguio | 150 | 28 | 5 | Sim |
| PT | Óbidos | 54 | 5 | 4 | Sim |
| PT | Sintra | 150 | 17 | 7 | Sim |
| US | Asheville | 150 | 83 | 85 | Sim |
| US | Savannah | 150 | 61 | 80 | Sim |

Novos países nesta rodada: Chile, Reino Unido, Itália, Marrocos, Indonésia, Filipinas e Nova Zelândia. Os contornos são os limites administrativos identificados, incluindo municípios/LGAs; por exemplo, City of Hobart e City of Launceston não representam um raio genérico em torno do centro.

## Pendências e limites das fontes

| Local | Cadastros únicos disponíveis |
|---|---:|
| Alvarães (BR) | 15 |
| Bonito (BR) | 17 |
| Lunenburg (CA) | 49 |
| Guernica (ES) | 26 |

As três pendências anteriores foram consultadas novamente com seletores comerciais amplos e classificação local, e com tentativa complementar de Overture; nenhuma recebeu empresas de municípios vizinhos para atingir a meta. Bonito/MS entrou nesta rodada e também ficou abaixo de 50 nos dados obtidos.

As quatro tentativas regionais da Overture retornaram HTTP 503. Falhas de fonte/rede não foram tratadas como ausência de empresas. Os novos registros desta rodada vieram do OSM/QLever, com licença ODbL 1.0, atribuição e fatos públicos preservados. A Overture continua como fonte independente no motor e nos registros existentes.

Os dados de identidade foram consultados em um lote finito no Wikidata/CC0; as relações e polígonos OSM exigiram identidade recíproca, país confirmado e âncora contida no contorno. Não houve geocodificação sistemática no Nominatim, raio substituto, download planetário nem scraping do Google Maps. Localidades com identidade/contorno ambíguos ou ausentes foram registradas como bloqueadas, sem importar dados com atribuição geográfica incerta.

A campanha avaliou 32 áreas (29 novas e três pendências). QLever usou cerca de 2,3 MB de respostas, em consultas sequenciais com teto por resposta/cidade. As quatro falhas Overture foram conservadoramente debitadas pelo teto integral de 24 MiB por tentativa: 96 MiB. Os limites explícitos foram 40 MiB de respostas QLever, 144 MiB de recortes Overture, até 100 chamadas QLever, seis recortes Overture e 20 minutos para iniciar trabalho. A consulta de muitos municípios foi truncada em 150 candidatos e não constitui censo local.

A importação conferiu geometria, país, licença, origem, segmento, tamanho do payload e IDs. Usou lotes de até 100, chave única da fonte e trava/orçamento compartilhados com o runtime. Preservou os fatos e datas já existentes e confirmou todos os IDs ao final. A gravação não marca a cobertura de cada município como completa.

Telefone público não confirma conta WhatsApp, titularidade ou funcionamento atual. Website ausente na fonte não comprova que a empresa não tenha site. A deduplicação é conservadora e pode manter registros sem evidência suficiente para fusão. Não houve envio de mensagens nem verificação em massa de websites.

Métricas completas de todas as 56 cidades, fontes, áreas bloqueadas e erros: [reports/catalog-expansion-round2-20261023.json](reports/catalog-expansion-round2-20261023.json). Os checkpoints/recortes públicos estão em `.artifacts/catalog-expansion-round2-20261023/` no ambiente de trabalho.
