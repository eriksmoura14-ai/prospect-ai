# Expansão do catálogo — 23/10/2026

> Atualização: a [segunda rodada](GLOBAL_CATALOG_EXPANSION_ROUND2.md) elevou o catálogo para 9.667 cadastros únicos em 56 cidades/24 países; 52 cidades atingiram 50. Os resultados abaixo documentam a primeira rodada.

Primeira campanha finita de ingestão no catálogo público de produção, sem publicar código na `main`, mudar a interface, ler contas privadas ou criar serviços/planos pagos. As fontes são OpenStreetMap via QLever (ODbL 1.0) e Overture Places 2026-10-21.0 (licenças e provedores preservados em cada registro).

## Resultado conferido no PostgreSQL de produção

| Métrica | Antes | Depois |
|---|---:|---:|
| Registros das fontes | 181 | 6100 |
| Cadastros únicos, por deduplicação conservadora | 179 | 6088 |
| Cidades com registros | 4 | 27 |
| Cidades com pelo menos 50 cadastros | 2 | 24 |

A base cobre **17 países e 6 continentes**, com **3955 cadastros únicos com telefone publicado**, 2748 com website informado e 4605 com endereço. A meta de 50 soma os 24 nichos suportados; não significa 50 por nicho.

Foram reutilizados 2.642 registros adicionais de testes públicos já licenciados, evitando novas consultas. A campanha acrescentou outros 3.277 registros das fontes. Os 6.100 identificadores persistidos conferem integralmente com o conjunto preparado para importação; não houve perda ou duplicação da identidade `(source, source_id)`. Os 6.100 possuem localização válida e pertencem a pelo menos uma área revisada do mesmo país; a validação PostGIS encontrou zero registros fora dessas áreas e zero registros sem a proveniência exigida. O catálogo ocupa cerca de 33,1 MB; tabela e índices de registros, 14,0 MB.

## Cobertura por cidade

| País | Cidade | Únicos antes | Únicos depois | Telefone | Website | Meta 50 |
|---|---|---:|---:|---:|---:|---|
| AR | Buenos Aires | 0 | 135 | 104 | 50 | Sim |
| AR | Ushuaia | 0 | 171 | 156 | 85 | Sim |
| AU | City of Sydney | 0 | 150 | 19 | 49 | Sim |
| BR | Alvarães | 1 | 15 | 2 | 0 | Pendente |
| BR | Araguari | 0 | 250 | 229 | 91 | Sim |
| BR | Gramado | 0 | 250 | 229 | 129 | Sim |
| BR | Monte Carmelo | 57 | 57 | 42 | 18 | Sim |
| BR | Tiradentes | 0 | 116 | 109 | 55 | Sim |
| BR | Uberlândia | 0 | 1149 | 894 | 476 | Sim |
| CA | Lunenburg | 26 | 49 | 37 | 36 | Pendente |
| CA | Quebec City | 0 | 150 | 55 | 66 | Sim |
| CA | Toronto | 0 | 929 | 654 | 634 | Sim |
| CO | Bogotá | 0 | 250 | 218 | 75 | Sim |
| DE | Berlin | 0 | 473 | 220 | 258 | Sim |
| DE | Cochem | 95 | 95 | 73 | 60 | Sim |
| DE | Monschau | 0 | 82 | 64 | 55 | Sim |
| ES | Guernica | 0 | 26 | 4 | 5 | Pendente |
| FI | Helsinki | 0 | 244 | 225 | 202 | Sim |
| FR | Paris | 0 | 250 | 217 | 174 | Sim |
| GH | Accra | 0 | 150 | 35 | 8 | Sim |
| GT | Antigua Guatemala | 0 | 150 | 10 | 14 | Sim |
| JP | Kyoto | 0 | 150 | 3 | 5 | Sim |
| KE | Nairobi | 0 | 150 | 14 | 16 | Sim |
| NP | Kathmandu | 0 | 150 | 63 | 0 | Sim |
| PT | Lisbon | 0 | 197 | 178 | 105 | Sim |
| RW | Kigali | 0 | 150 | 20 | 6 | Sim |
| US | New York City | 0 | 150 | 81 | 76 | Sim |

Alvarães (15), Lunenburg (49) e Guernica/Gernika-Lumo (26) permanecem abaixo da meta. As consultas complementares interrompidas por rede não foram interpretadas como ausência de empresas. Os limites municipais foram preservados; estabelecimentos de municípios vizinhos não foram usados para completar a meta. Jaipur foi excluída por divergência entre a cidade e a identidade distrital; Adelaide, por representar um contorno metropolitano sem limite administrativo confirmado. O polígono de Sydney é o LGA City of Sydney, não toda a região metropolitana. Baghlan já existia como província sem registros e não foi contada como cidade.

## Correção encontrada durante a coleta

O extrator Overture filtrava pelo envelope, aplicava `LIMIT` e só depois descartava pontos fora do município no Node. Em contornos irregulares, empresas vizinhas consumiam todos os candidatos. O leitor agora aplica o Polygon/MultiPolygon completo **antes de `LIMIT`**, com tratamento de buracos, ilhas e bordas, sem dependência espacial adicional. O Node/PostGIS mantém a validação final. O predicado é validado antes de qualquer acesso à fonte. Chamadas antigas com apenas envelope continuam compatíveis.

Comparação real com a mesma release, município, conjunto de categorias e teto de 250 candidatos: **Paris: 1 → 250**; **Bogotá: 0 → 250** registros válidos. Esses valores são amostras, não totais de todas as empresas das cidades. A correção está na branch de revisão; os dados produzidos por ela já foram importados. Não foi feito deploy desse código na produção.

Validação: **29 testes Node e 10 testes Python aprovados**, incluindo Parquet real em fixture que coloca o primeiro candidato fora de um município em L e confirma que o candidato válido posterior não é perdido pelo limite. Testes de ilhas, buracos, bordas, orçamento, TLS/extensão e proveniência foram preservados.

## Orçamento, checkpoints e limitações

A campanha usou áreas de identidade revisada a partir de Wikidata (CC0) e polígonos OSM/QLever, além das áreas já confirmadas do catálogo. Não fez geocodificação sistemática no Nominatim público, scraping do Google Maps nem download do planeta. Overture leu apenas recortes/colunas por HTTP Range, com teto por cidade, execução sequencial e cache de metadados. QLever teve consultas finitas por cidade, com candidatos e respostas limitados.

A conexão HTTP do ambiente de coleta falhou temporariamente com respostas do proxy Envoy; um controle independente falhou até para o `/health` do Prospect. Essas falhas não provam queda dos operadores. A integração SQL continuou disponível e concluiu a importação por lotes, protegida por unicidade, trava e limites de 50 mil registros/64 MiB. A soma conservadora de leituras, incluindo franquia integral debitada para falhas/interrupção e tentativa final, foi de aproximadamente **359,8 MiB**, abaixo do teto de 384 MiB. Não há coleta mundial contínua ativada. Os checkpoints e os recortes públicos estão em `.artifacts/catalog-expansion-20261023/` no ambiente de trabalho.

Contatos, websites e situação operacional são fatos informados pelas fontes, sujeitos a erro/desatualização. Telefone publicado não confirma conta WhatsApp; website não informado não comprova ausência de site. Não foi feita verificação em massa de websites nem contato com empresas. A deduplicação conserva entidades sem evidência suficiente para fundir; não se afirma um cadastro canônico mundial. O crescimento posterior exige novas campanhas limitadas e monitoramento do plano gratuito.

As importações não marcam uma cidade como completamente coberta. Muitas consultas terminaram no teto de 150/250 candidatos e outras tiveram falhas de rede preservadas; buscas interativas podem acrescentar mais dados. Os registros mantêm origem, licença e datas; reexecutar a gravação não duplica IDs da fonte.

Relatório de métricas: [reports/catalog-expansion-20261023.json](reports/catalog-expansion-20261023.json).
