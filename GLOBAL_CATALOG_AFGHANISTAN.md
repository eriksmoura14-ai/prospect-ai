# Afeganistão — coleta pública limitada de 23/10/2026

A solicitação foi encontrar 10.000 empresas do Afeganistão. **A meta não foi atingida.** Foram obtidos e importados **2.799 cadastros únicos por deduplicação conservadora**, a partir de 4.267 registros das fontes. Esse resultado mede esta coleta e seus seletores; não significa que existam somente 2.799 empresas no país.

## Resultado conferido

| Métrica | Antes no país | Depois no país |
|---|---:|---:|
| Registros das fontes | 0 | 4.267 |
| Cadastros únicos por deduplicação conservadora | 0 | 2.799 |
| Com telefone público | 0 | 1.035 |
| Com website informado | 0 | 430 |
| Com endereço | 0 | 1.110 |
| Com localização dentro do polígono nacional | 0 | 2.799 |
| Compatíveis com os nichos selecionáveis atualmente | 0 | 616 |

**Os outros 2.183 cadastros são de setores comerciais adicionais**, como varejo, hotéis e serviços privados. Estão no catálogo reutilizável, mas não estão todos acessíveis pelos 24 nichos atuais da interface. Esta rodada não altera os filtros nem publica código da aplicação. Não se promete que todos os nomes de cidades das fontes sejam reconhecidos pela geocodificação atual.

O catálogo global passou de 9.687 para **13.954 registros de fonte**, correspondentes a **12.466 cadastros únicos conservadores**, em 25 países. Permanecem 56 áreas municipais anteriormente revisadas; o contorno nacional importado não foi contado como nova cidade.

## Fontes e geografia

| Fonte/acesso | Registros aceitos no país | Observação |
|---|---:|---|
| OSM via Geofabrik | 1.478 | Extrato nacional `afghanistan-261022.osm.pbf`, 112.605.449 bytes; ODbL 1.0 |
| OSM via QLever | 1.473 | Mesmos dados-base OSM; não é fonte independente da Geofabrik |
| Overture Places 2026-10-21.0 | 1.316 | Provedores e licenças preservados por registro |

O extrato Geofabrik contém dados até `2026-10-22T20:21:33Z`. A leitura completa de nós e vias encontrou 4.172 candidatos nomeados; a classificação comercial rejeitou 2.694. Escolas, locais religiosos, repartições, hospitais, ONGs e outras instituições públicas não foram usados para aumentar o total. Estabelecimentos abandonados/desativados também foram excluídos. Categorias de clínica/consultório informadas pelas fontes não comprovam propriedade privada ou operação atual.

O país foi identificado por Wikidata Q889/CC0, relação OSM 303427 e código AF recíprocos. O recorte final usa o polígono nacional integral, com PostGIS, e não um raio em torno de Cabul. As coordenadas de vias OSM são centros do envelope, explicitamente aproximadas; não representam entradas verificadas. Cidade e estado só são preenchidos quando informados pela fonte. Foram limpos 74 rótulos de localidade que diziam apenas o país, preservando o texto original nos metadados. Não se inventou um município para pontos rurais. A antiga área de Baghlan representa uma província e continua fora da contagem de cidades.

O extrato foi baixado com ranges HTTP suportados pelo publicador, validação exata de intervalo/tamanho e checkpoint. Após o prazo de execução, a transferência continuou dos 104.857.600 bytes já validados, sem baixar o arquivo novamente. SHA-256: `e9bae529143c70655dc796e870e69c7be59549d9334c4493917d34333f954ef7`. Um primeiro parser interrompeu aos 120 segundos; seus dados parciais não foram importados. A execução com pré-filtro C++ do osmium terminou integralmente.

Na Overture, uma consulta nacional inicial terminou no prazo de 65 segundos. Um recorte de Cabul respondeu com 772 candidatos. Outra leitura nacional terminou no prazo de 75 segundos, preservando ranges validados; a execução seguinte reutilizou esse cache e terminou em aproximadamente 75 segundos, dentro do teto de 180 segundos do operador. Retornou 1.316 candidatos para os 79 seletores comerciais aprovados, sem truncamento no teto de 10.000. O polígono nacional foi aplicado na normalização final. As falhas anteriores são erros, não evidência de ausência de empresas. O runtime em produção não recebeu alteração de prazo ou orçamento.

## Deduplicação, licenças e verificação

As observações de fonte ficam separadas no PostgreSQL, com unicidade `(source, source_id)`. A apresentação combina a mesma identidade OSM e usa país, nome normalizado, distância e telefone/endereço compatíveis para outras fusões. Geofabrik tem prioridade sobre a observação OSM anterior. Identidades antigas ausentes do extrato completo não foram reintroduzidas como nós/vias atuais. A deduplicação conserva casos incertos; não é um registro jurídico canônico de empresas.

A importação foi aditiva, em lotes de até 100, com trava e limites existentes de 50 mil registros/64 MiB. O conjunto de IDs do Afeganistão confere integralmente com o preparado (`5ed1405bb1bd2d4a6632261be310ae2e`). Os 9.687 IDs de outros países mantiveram o checksum anterior (`0092e5e957da600cfde04d3987cc2792`). O PostGIS encontrou zero registros fora do país, zero coordenadas inválidas e zero proveniências inválidas. Tabela/índices de registros: 30.859.264 bytes; banco: 55.140.352 bytes. O `/health` da produção retornou HTTP 200 e `ok: true`.

Passaram 18 verificações automatizadas do lote, incluindo exclusão de instituições mesmo com nomes semelhantes a nichos, abandono/vacância, país incompatível, ponto fora do contorno e deduplicação da mesma identidade entre fontes. Todos os registros importados tiveram identidade, licença, proveniência, localização e tamanho de payload validados. Não houve mudança no código da aplicação que justificasse repetir toda a suíte.

OSM mantém atribuição e ODbL 1.0/share-alike. Overture conserva licenças e provedores aprovados por observação (CDLA-Permissive 2.0, Apache 2.0 e CC0). O pacote derivado acompanha as obrigações ODbL e as atribuições originais, além dos metadados de cada registro. Não houve scraping do Google Maps, consulta paga, compra de dados, contato com empresas ou armazenamento de contas privadas.

Telefone público não confirma WhatsApp, titularidade ou funcionamento. Website não informado continua sendo informação insuficiente; não comprova ausência de site. Situação operacional e contatos não foram verificados em massa. A coleta não marca nenhuma cidade nem o país como completamente cobertos e não ativa varredura contínua.

Métricas, limites e falhas: [reports/catalog-afghanistan-20261023.json](reports/catalog-afghanistan-20261023.json). O pacote CSV/JSON com 2.799 cadastros e licenças está no artefato de trabalho `.artifacts/catalog-afghanistan-20261023/prospect-afghanistan-20261023.zip` (562.040 bytes). Campos CSV que poderiam ser interpretados como fórmulas receberam prefixo de segurança; o JSON conserva os valores públicos originais.
