# Descoberta opcional com Geoapify — validada no serviço de teste

A evidência existente mostra conexões TCP/TLS estabelecidas e ausência de resposta até para consultas mínimas do Overpass. Isso não prova consulta comercial lenta, ausência de empresas ou bloqueio específico do Render. O agente e niches.cjs permanecem intactos.

## Ativação no serviço de teste

No serviço `prospect-ai-discovery-test`, configure `GEOAPIFY_API_KEY` em Environment sem colocar seu valor em arquivos, PR ou conversa. Configure também `BUSINESS_PROVIDER=geoapify`. O padrão continua `overpass`; apenas salvar a chave não ativa outro provedor.

O cliente novo envia a chave somente no cabeçalho HTTPS `x-api-key` ao endpoint fixo oficial. Não registra URL com credencial, corpo de erro remoto ou segredo. O diagnóstico autenticado existente mostra somente se a chave está configurada e qual provedor foi selecionado. Logs de inicialização também mostram somente esses indicadores.

A descoberta solicita o GeoJSON completo ao mesmo geocodificador e usa Polygon/MultiPolygon com todas as partes e buracos, sem simplificação ou buffer. Sem geometria administrativa, falha explicitamente. Se a geometria exceder os limites documentados (10.000 posições, 100 anéis, 102.400 bytes), consulta o retângulo integral e filtra os pontos localmente pelo polígono original intacto, incluindo partes e buracos. Não simplifica, não usa raio e não aceita pontos externos como pertencentes à cidade. Localidades originalmente selecionadas sem relação mantêm seu retângulo integral.

A consulta usa grupos comerciais documentados. Barber/Hair Salon usam service.beauty.hairdresser; Auto Detailing usa service.vehicle; Electrician usa service.electrician. Sem correspondência nesses grupos, ou em nichos sem grupo específico documentado, consulta commercial/service/office. Não mistura índices de rios, fronteiras ou edifícios, que os testes reais mostraram mascarar a seleção comercial. Esses índices têm cobertura diferente de todos os objetos Overpass; essa limitação é identificada na interface. Cada resultado precisa ter identidade, coordenadas e tags OSM originais. A função original businessMatch continua fazendo a seleção; nenhuma tag comercial é fabricada a partir de categorias do Geoapify. O agente e suas regras permanecem intactos.

## Cobertura e gratuidade

Geoapify indexa POIs; essa base não é uma cópia consultável de todos os objetos Overpass. A interface identifica `Índices comerciais do Geoapify`; não há alegação de cobertura equivalente nem de exaustividade mundial. Um nicho ausente da indexação não pode ser recuperado apenas com paginação. Fonte: https://apidocs.geoapify.com/docs/places/ .

A consulta pagina em blocos de 500, até quatro páginas no total compartilhadas entre categoria e alternativa (aproximadamente 100 créditos nominais por busca). Se quatro páginas estiverem cheias, se houver resultados repetidos ou erro em qualquer página, não apresenta lista parcial como concluída e não salva essa descoberta no cache. Uma página final curta significa término da paginação dessa consulta, não prova de exaustividade da base. Esse limite é de orçamento, sem reduzir a área ou seletores. O plano gratuito anunciado tem 3.000 créditos/dia; a cota é compartilhada e não oferece uso ilimitado. HTTP 429 é falha explícita; não há contratação, upgrade ou retry automático. Fonte: https://www.geoapify.com/pricing/ .

Atribuições de OpenStreetMap e Geoapify aparecem no rodapé.

## Testes e critérios

`node --check server.cjs`, `node --check geoapify.cjs` e `node --test test/*.test.cjs` passam localmente. 79 testes locais passam. Os testes controlados exercitam geometria completa, ausência de geometria, paginação, erros de cota, orçamento, identidade OSM, classificação existente e sigilo no transporte. Não são prova de funcionamento público.

Foram executadas buscas reais no próprio processo do serviço isolado do Render, mediante flag de validação limitada pelo nome do serviço. Elas passaram pela função de descoberta completa, usando a chave exclusivamente no runtime. Não foram fixtures nem apenas probes. A verificação de websites e o agente de IA não foram executados nessas buscas; o teste comprova a etapa de descoberta, não o fluxo completo do frontend nem todos os países/nichos. Não basta `/health` ou build verde.

Arquivos de execução desta integração: `server.cjs`, novo `geoapify.cjs`, `index.html`. A branch também depende dos módulos `overpass.cjs` e `hosting.cjs` já adicionados anteriormente; não copie server.cjs sozinho para main. Teste novo: `test/geoapify.test.cjs`; build do serviço separado: `render.test.yaml`. Nenhuma chave foi incluída.

Estado: descoberta real validada em três países no serviço de teste. A chave foi configurada pelo usuário no serviço isolado e não foi lida nem exibida pelo agente. Não houve merge em main nem implantação desta integração em produção.

## Evidência real de 2026-10-04 (horário de Brasília)

Revisão executada: f9033b1b425958509617f0732676dc122452e700, serviço prospect-ai-discovery-test, deploy dep-db1akgrncjis73buhulg.

| Cidade e nicho | Resposta do provedor | Classificados após filtros/deduplicação | Tempo das consultas |
| --- | --- | --- | --- |
| Uberlândia, Brasil — Barber | HTTP 200, 43 candidatos, uma página | 3 | 1.156 s |
| Saskatoon, Canadá — Barber | HTTP 200, 35 candidatos, uma página | 5 | 0.562 s |
| Sydney, Austrália — Auto Detailing | HTTP 200, quatro páginas com 500/500/500/176 candidatos | 88 | 13.524/10.550/11.153/11.119 s; 46.346 s nas requisições |

Exemplos públicos classificados: Zion Barbearia (node/13129731588), Barbearia Botelho (node/13129731097), New Style Barbershop (node/5873538729); Hollywood Barbershop (node/13923046832), SRT Barbershop (node/13139965338); Nara Wash n' Shine (way/264421528), Ecospray Car Wash Cafe (way/663360419), IMO Car Wash (node/3145141688). Os exemplos vieram da resposta real do provedor e passaram pela função businessMatch original.

Foram corrigidos dois problemas na primeira integração experimental: misturar índices geográficos mascarava a seleção de empresas, produzindo listas não comerciais; sockets HTTPS reutilizados não emitem outro secureConnect, e o temporizador de conexão precisava reconhecer essa condição para não cancelar uma resposta lenta após 5 s. O segundo problema foi observado em Sydney e confirmado pela nova execução: socket reutilizado, respostas HTTP 200 e quatro páginas completas.

Isso não identifica por que os operadores Overpass deixaram de responder. A solução evita essa dependência por meio do provedor configurado, respeitando sua cobertura e cota próprias. Sydney demonstra que buscas grandes ainda podem demorar; não há promessa de resposta instantânea ou cobertura mundial equivalente ao Overpass.

GEOAPIFY_DISCOVERY_CHECK deve ficar em 0 após a validação. Se habilitado, os checks são limitados ao nome prospect-ai-discovery-test; nunca executam no serviço principal.

Teste público real de geocodificação em 2026-10-04: Nominatim selecionou Uberlândia como relação 314875, Polygon com um anel e 10.413 posições. Esse caso aciona a consulta do retângulo completo seguida pelo filtro local exato. Esse teste prova obtenção da geometria pública; não prova resposta de empresas do Geoapify.
