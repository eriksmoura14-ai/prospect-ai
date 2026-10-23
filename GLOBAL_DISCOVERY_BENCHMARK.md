# Comparação real de descoberta — 2026-10-23

**Atualização posterior:** a homologação pelo Render, com correções de gravação e extensão, retornou resultados nas sete cidades. Veja [GLOBAL_DISCOVERY_STAGING.md](GLOBAL_DISCOVERY_STAGING.md). As tentativas anteriores abaixo permanecem preservadas com suas falhas.

Base antiga: `f876edde5df0c178245411f48ed3a7c94953b641`. Segmento fixo: **Restaurantes**. A mesma seleção de país/subdivisão e respostas reais de geocodificação foram reutilizadas. O código antigo foi carregado diretamente do commit original, incluindo o adaptador QLever original. Não houve escrita em produção, consulta de contas WhatsApp, mensagens ou verificação dos websites durante a medição.

## Rodada online inicial

Tempos abaixo medem descoberta, com geocodificação de rede reutilizada, sem a etapa de verificação de sites. O novo inclui leitura, normalização, recorte e persistência local. Os valores não são medianas de repetidas rodadas nem um teste controlado de capacidade dos servidores públicos.

| Cidade | Antigo: únicos | Novo: únicos | Com telefone publicado | Com website publicado | Com endereço | Com localização válida | Tempo antigo → novo (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Berlin | 500 | 473 | 228 → 220 | 272 → 258 | 365 → 347 | 500 → 473 | 2.90 → 73.97 |
| Monschau | 39 | 73 | 26 → 56 | 27 → 48 | 26 → 59 | 28 → 73 | 0.80 → 24.87 |
| Cochem | 52 | 95 | 33 → 73 | 28 → 60 | 37 → 80 | 52 → 95 | 1.34 → 13.44 |
| Uberlândia | 175 | 1135 | 15 → 931 | 5 → 495 | 35 → 1021 | 114 → 1135 | 1.26 → 38.98 |
| Monte Carmelo | 13 | 51 | 1 → 42 | 0 → 18 | 4 → 45 | 7 → 51 | 0.81 → 20.58 |
| Toronto | 500 | 398 | 179 → 144 | 181 → 148 | 337 → 266 | 500 → 398 | 1.84 → 47.16 |
| Lunenburg | 7 | inconclusivo | 3 → — | 5 → — | 2 → — | 2 → — | 0.84 → 0.64 |

Berlim e Toronto atingiram o limite de candidatos e não apresentaram ganho na rodada: a Overture não concluiu dentro dos recursos disponíveis. O recorte por geometria e a interpretação conservadora das coordenadas também mudam o conjunto retornado em relação ao índice de contenção original. Lunenburg terminou com erro de fontes, não com uma lista de zero empresas.

| Cidade | Candidatos QLever | QLever aceitos geograficamente | Candidatos Overture | Overture aceitos geograficamente | Antes da deduplicação entre fontes | Após deduplicação |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Berlin | 500 | 473 | — | — | 473 | 473 |
| Monschau | 49 | 28 | 64 | 48 | 76 | 73 |
| Cochem | 71 | 52 | 60 | 45 | 97 | 95 |
| Uberlândia | 186 | 114 | 1202 | 1023 | 1137 | 1135 |
| Monte Carmelo | 13 | 7 | 48 | 44 | 51 | 51 |
| Toronto | 500 | 398 | — | — | 398 | 398 |
| Lunenburg | — | — | — | — | — | — |

O fluxo antigo não expunha contagem bruta antes da deduplicação; esse campo permanece `null` no relatório, sem reconstrução especulativa. Os candidatos Overture do retângulo são recortados pelo polígono completo, portanto não equivalem todos a negócios na cidade. As contagens de telefone/site indicam campos publicados, sem confirmar atualidade, titularidade ou WhatsApp.

Taxa de falha completa da busca: antigo **0/7**; novo inicial **1/7 (14,3%)**. Cobertura operacional das fontes no novo: QLever trouxe candidatos em **6/7** cidades; Overture concluiu **4/7** recortes. Os demais retornaram timeout, limitação de recursos ou HTTP 503. Não há evidência para afirmar que a nova versão ficou mais estável em todas as cidades ou que a busca fria ficou mais rápida.

## Reutilização real no catálogo

Após a coleta, o código atual consultou o PostGIS local e repetiu a deduplicação, sem rede. Essa medição inclui consulta, materialização de registros e merge em Node; não inclui login, verificação de site, geocodificação ou atualização externa. Banco local não representa latência de Neon hospedado.

| Cidade | Registros locais únicos | Telefones com formato válido | Consulta + deduplicação local (ms) |
| --- | ---: | ---: | ---: |
| Berlin | 473 | 220 | 105.55 |
| Monschau | 73 | 56 | 16.41 |
| Cochem | 95 | 73 | 7.92 |
| Uberlândia | 1135 | 915 | 275.84 |
| Monte Carmelo | 51 | 42 | 8.21 |
| Toronto | 398 | 144 | 30.85 |
| Lunenburg | 0 | 0 | 1.36 |

Lunenburg possui zero registros **no cache desta execução**, pois a coleta falhou; isso não é uma conclusão sobre a cidade. Os demais números conferem com os dados reais persistidos. A biblioteca de numeração valida formato, não uma linha ativa.

## Repetição online com a versão final

A rodada online inicial antecedeu os ajustes adicionais de centro aproximado de geometrias OSM, cache de STAC imutável e redução do limite padrão Overture de 3.000 para 1.000 registros. Esses ajustes têm testes automatizados e o catálogo foi consultado novamente pelo código atual, como registrado acima.

Após uma recuperação transitória do acesso ao catálogo STAC, a matriz inteira foi repetida com o código final `31cf784ae6f5c72a12c1ff14458eb6ec4278cbe5`, em **outro PostGIS descartável vazio**, sem aproveitar os registros da rodada inicial. O resultado completo foi preservado, inclusive as falhas:

| Cidade | Resultado final online | Únicos | Com telefone / website / endereço / localização válida | Tempo (s) |
| --- | --- | ---: | --- | ---: |
| Berlin | Parcial: QLever disponível, Overture HTTP 503 | 473 | 220 / 258 / 347 / 473 | 41.07 |
| Monschau | Ambas as fontes falharam com HTTP 503 | — | — | 1.16 |
| Cochem | Ambas as fontes falharam com HTTP 503 | — | — | 0.91 |
| Uberlândia | Ambas as fontes falharam com HTTP 503 | — | — | 0.76 |
| Monte Carmelo | Ambas as fontes falharam com HTTP 503 | — | — | 0.75 |
| Toronto | Ambas as fontes falharam com HTTP 503 | — | — | 1.09 |
| Lunenburg | Ambas as fontes falharam com HTTP 503 | — | — | 0.87 |

Taxa de falha completa nessa repetição: **6/7 (85,7%)**; QLever trouxe dados em 1/7 cidades e Overture não concluiu nenhum dos sete recortes. Falha não é contabilizada como zero empresas. A ponte de rede do ambiente havia retornado HTTP 503 inclusive para STAC e GitHub, com erro de conexão antes dos headers (`cloudflare_https_tunnel`); a recuperação não se sustentou. O benchmark não consegue separar esse caminho de rede de eventual falha dos operadores. Isso não permite atribuir a causa ao Render nem declarar indisponibilidade geral das fontes. Não foram contornados proxy, TLS, limites ou controles de acesso, e não houve repetição automática das sete cidades.

Portanto, a versão final **não possui uma matriz online completa bem-sucedida**. Os ganhos da primeira coleta e sua reutilização local estão demonstrados; a confiabilidade de coleta fria precisa de nova homologação quando houver acesso estável. As duas rodadas permanecem separadas no JSON agregado, sem escolher o melhor resultado de cada tentativa.

O ganho demonstrado é no conjunto real de dados coletados em Monschau, Cochem, Monte Carmelo e Uberlândia, com uma fonte independente adicional e persistência reutilizável. Não é comprovação de cobertura mundial, censo de empresas ativas ou precisão manual de cada contato. A deduplicação é conservadora e pode deixar duplicatas cuja identidade não pôde ser comprovada.

## Reprodução

1. Use banco PostGIS **descartável em loopback**, variáveis de teste e dependências de `GLOBAL_DISCOVERY.md`.
2. O script `test/global-benchmark.cjs` exige `DISCOVERY_LIVE_TEST=seven-selected-cities`. É manual e limitado a sete cidades; não faz parte de `npm test` nem executa em CI.
3. O arquivo de geocodificação real está em `.artifacts/global-discovery-20261023/geocodes.json` no workspace de execução; foi reutilizado para evitar chamadas redundantes ao Nominatim. Em um clone novo, prepare-o uma única vez com `DISCOVERY_LIVE_TEST=seven-selected-cities node --use-env-proxy scripts/prepare-global-benchmark.cjs`. O helper limita a coleta às sete localidades, uma thread, 1,1 s entre inícios, sem retries de quota/rede e com cache/retomada. Não o execute em paralelo com a aplicação ou outras consultas ao Nominatim; respeite a política da aplicação inteira. Pode usar `NOMINATIM_URL` de um serviço próprio. O benchmark usa o segmento Restaurantes.
4. `node --use-env-proxy test/global-benchmark.cjs baseline` carrega o commit antigo; `... new` usa `TEST_DISCOVERY_DATABASE_URL` e `OVERTURE_PYTHON`. Em Node 22, configure o proxy suportado pelo seu ambiente; não desative TLS. Repita somente quando as fontes estiverem acessíveis e respeite suas políticas.
5. O JSON agregado versionado em `reports/global-discovery-20261023.json` contém métricas, resultados por fonte, limitações e hashes dos artefatos. Os registros públicos completos e geometrias não são publicados automaticamente no repositório.
