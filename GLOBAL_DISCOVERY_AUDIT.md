# Auditoria do mecanismo de descoberta

Data: 2026-10-23. Base auditada: `f876edde5df0c178245411f48ed3a7c94953b641`.
A leitura da estrutura, módulos de busca, geocodificação, persistência, autenticação e implantação precedeu as alterações. Nenhum teste desta missão escreveu na produção.

## Estrutura encontrada

| Camada | Arquivos e comportamento |
| --- | --- |
| Interface | `index.html`, `app.js`, `dashboard.js`, `location-picker.js`, `prospects-ui.js`; JavaScript sem framework, globo Three.js e estilos existentes |
| HTTP/backend | `server.cjs`, processo Node com uma busca ativa por processo; jobs em memória, polling em `GET /api/jobs/:id` |
| Localidades | `locations.cjs`, pacote de países/subdivisões/cidades; `geocoding.cjs` e `locate()` no servidor validam país, subdivisão e nome |
| Descoberta | `qlever.cjs`, `overpass.cjs`, `geoapify.cjs`; um único `BUSINESS_PROVIDER` é escolhido na inicialização |
| Classificação | `niches.cjs`, `niche-matching.cjs`, `businessMatch()`; 24 segmentos, tags, culinárias e palavras-chave |
| Sites/contatos | `contacts.cjs`, `website-evidence.cjs`; números internacionais, indicações explícitas de WhatsApp e verificação limitada de identidade pública |
| Dados privados | `accounts.cjs`, `prospects.cjs`, `db/schema.sql`; sete tabelas, histórico e listas cifrados por conta |
| Hospedagem | Render executa Node; Vercel/Netlify podem servir a interface e encaminhar a API. `static-resources.cjs` e o build usam uma lista explícita de arquivos públicos |

Rotas existentes preservadas: autenticação e recuperação em `/api/auth/*`, conta e preferências em `/api/account`, localidades em `/api/locations/*`, segmentos em `/api/niches`, buscas em `/api/search`, jobs em `/api/jobs/*`, histórico em `/api/history`, listas em `/api/lists/*`, IA em `/api/ai` e diagnóstico protegido em `/api/diagnostics/overpass`.

## Problemas demonstráveis no código original

1. **Fonte única por pesquisa.** O `discover()` seleciona QLever, Geoapify ou Overpass em um `if/else`. Uma lista vazia ou falha não aciona uma base independente. Geoapify também exige identidade e tags OSM originais neste projeto; não representa uma base independente de negócios neste fluxo.
2. **Dependência do índice da localidade no QLever.** A consulta exige `?region name ?regionName` e `region ogc:sfContains ?poi` para relações. Não tenta descobrir por geometria quando a relação/índice espacial não está disponível. Não se pode atribuir toda resposta vazia à falta de POIs.
3. **Geometrias descartadas.** O decodificador `point()` interpreta somente WKT `POINT`. Detalhes de estabelecimentos em ways/relações podem trazer polígonos, embora o servidor original permita linhas QLever sem coordenadas. A rodada real encontrou 13 registros/7 coordenadas em Monte Carmelo e 7/2 em Lunenburg.
4. **Retângulo de place-node não é município.** Para localidades sem relação, a busca usa o `boundingbox` do geocodificador. Um retângulo pequeno ao redor do núcleo não demonstra que bairros, distritos ou zona rural foram consultados. O novo motor exige polígono municipal/distrital confirmado; não inventa um raio para completar essa lacuna.
5. **Cochem e associação administrativa homônima.** O geocodificador retornou a cidade e a associação Cochem, com `place_rank` 16 e 14. O seletor original atribuía a mesma bonificação aos dois. A seleção agora prefere o município e possui teste com a ordem dos resultados invertida.
6. **Validação de homônimos já existia, mas não era completa.** País, códigos ISO de subdivisão e nomes alternativos eram conferidos. Não foram removidas essas proteções. O modo global recusa relações homônimas de mesmo nível em áreas disjuntas, em vez de escolher silenciosamente a primeira.
7. **Limites, paginação e classificação.** QLever limita a consulta a 501 linhas e devolve até 500 candidatos, sem paginação. Geoapify usa quatro páginas de 500 e falha ao ultrapassar seu orçamento. Há limite angular geral de 2° × 3°. Os termos de vários serviços são principalmente ingleses; segmentos apenas por nome perdem negócios com nomes locais. Foram preservados os critérios OSM existentes, e a Overture usa taxonomia explícita, sem fabricar tags OSM a partir dela.
8. **429/timeouts não significam cidade inválida.** Nominatim/LocationIQ têm prazo de 10 s por tentativa e 30 s total, sem repetição automática de quota/rede; Overpass tem conexão/prazo total separados e sondagem mínima; QLever tem 45 s. O código antigo deliberadamente não mudava de provedor nesses casos. Espera sem headers não identifica sozinha fila, operador ou caminho de rede.
9. **Cache local e isolamento privado.** `.cache/data.json` é efêmero e compartilhado somente pelo processo/arquivo. Histórico cifrado expira em 30 dias. Não havia tabela comercial consultável espacialmente, índice PostGIS, proveniência persistida por fonte nem checkpoint de descoberta.
10. **Deduplicação limitada.** O algoritmo original percorre o resultado acumulado e identifica IDs OSM ou nomes próximos com evidência de endereço/telefone. Não conhece identificadores Overture, nem preserva licenças de fontes distintas. A implementação nova mantém deduplicação conservadora e índices de candidatos locais; não afirma resolver universalmente a identidade de empresas.
11. **Latência de verificação é outra etapa.** Três trabalhadores verificam até 50 empresas, cada uma com até 12/25 s. Isso pode dominar o tempo total mesmo com descoberta rápida. O benchmark mede descoberta separadamente. O modo global limita o início de novas verificações a uma janela de 30 s, mantendo pendências como incerteza.

## Fontes, permissões e decisão de integração

Documentação consultada em 2026-10-23:

- [Overture Places](https://docs.overturemaps.org/guides/places/), [DuckDB](https://docs.overturemaps.org/getting-data/duckdb/), [atribuição](https://docs.overturemaps.org/attribution/) e [STAC](https://stac.overturemaps.org/catalog.json). Release fixada: **2026-10-21.0**. O esquema atual usa `taxonomy.primary`, `taxonomy.hierarchy`, `basic_category`, `phones`, `websites`, `addresses`, `sources`, `confidence` e `operating_status`. Confiança de existência não comprova contatos, abertura no momento nem titularidade.
- A documentação atual de Places informa que esse tema **não contém OSM**, com CDLA Permissive 2.0, Apache 2.0 e componentes CC0. O adaptador fixa a release, conserva provedores originais e rejeita datasets não revisados. Outras releases precisam de revisão de esquema/licença; não herdam automaticamente essa decisão.
- [Geofabrik](https://download.geofabrik.de/) e [licença OSM](https://www.openstreetmap.org/copyright): extratos regionais ODbL 1.0. Geofabrik é um meio de obter OSM, não uma segunda base independente. Foi implementada extração de PBF local e importação com checkpoint; nenhum extrato continental/planetário foi baixado.
- [Política do Nominatim](https://operations.osmfoundation.org/policies/nominatim/): uso interativo moderado, identificação da aplicação, cache e no máximo 1 requisição/s para a aplicação inteira. Não deve alimentar varreduras sistemáticas ou autocomplete. Os sete exemplos foram consultados sequencialmente e reutilizados de arquivo. O worker aceita áreas previamente resolvidas e não geocodifica países/cidades em massa. A limitação existente por processo não substitui coordenação entre réplicas; no MVP mantenha uma instância e use um geocodificador próprio/configurado para escalar.
- AllThePlaces/CC0 aparece na própria composição da Overture. Não foi ativada uma segunda coleta integral de cadeias. Dados governamentais e registros empresariais podem ter licenças e informações pessoais diferentes por país; não foi incluído um scraper genérico nem presumida permissão de redistribuição.

Separar registros por fonte e conservar a licença **não elimina** obrigações ODbL de bases derivadas. Exibição/exportação conserva atribuição; quem publicar uma base derivada deve cumprir compartilhamento e disponibilização aplicáveis. Nenhuma conclusão jurídica universal é presumida para outras fontes.

## Escopo efetivamente implementado

Motor opcional `DISCOVERY_ENGINE=global`, geometria completa, PostGIS local primeiro, OSM por geometria, Overture regional, importação Geofabrik, união com proveniência, qualidade conservadora, cache de cobertura por fonte/área/segmento, fila com concessões/checkpoint/retomada e limites de recursos. Credenciais ficam no backend. A autenticação, histórico e lista privada existentes continuam separados do catálogo público.

Limitações e resultados reais estão em `GLOBAL_DISCOVERY_BENCHMARK.md`; configuração, migração e operação estão em `GLOBAL_DISCOVERY.md`. A produção e a branch principal não foram modificadas por esta missão.
