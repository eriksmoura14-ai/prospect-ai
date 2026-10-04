# Descoberta opcional com Geoapify — validação pendente

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

`node --check server.cjs`, `node --check geoapify.cjs` e `node --test test/*.test.cjs` passam localmente. 78 testes locais passam. Os testes controlados exercitam geometria completa, ausência de geometria, paginação, erros de cota, orçamento, identidade OSM, classificação existente e sigilo no transporte. Não são prova de funcionamento público.

Antes de promover: executar uma busca real autenticada no serviço de teste (Uberlândia e cidades em outros países), verificar localidade selecionada e limite completo, obtenção de páginas, tags OSM e empresas reais classificadas, além de ausência de mensagens de erro. Verificar a cota real na conta Geoapify. Não basta `/health`, teste mínimo ou build verde.

Arquivos de execução desta integração: `server.cjs`, novo `geoapify.cjs`, `index.html`. A branch também depende dos módulos `overpass.cjs` e `hosting.cjs` já adicionados anteriormente; não copie server.cjs sozinho para main. Teste novo: `test/geoapify.test.cjs`; build do serviço separado: `render.test.yaml`. Nenhuma chave foi incluída.

Estado: integração implementada na branch de revisão; consulta real do Geoapify no Render ainda não validada. A chave informada pelo usuário está no serviço principal, não confirmada no serviço de teste. Não houve merge em main nem implantação desta integração em produção.

Teste público real de geocodificação em 2026-10-04: Nominatim selecionou Uberlândia como relação 314875, Polygon com um anel e 10.413 posições. Esse caso aciona a consulta do retângulo completo seguida pelo filtro local exato. Esse teste prova obtenção da geometria pública; não prova resposta de empresas do Geoapify.
