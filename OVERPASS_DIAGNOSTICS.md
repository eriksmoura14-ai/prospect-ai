# Localização global e diagnóstico da descoberta de empresas

Esta alteração corrige colisões de cache e seleção de nomes de cidades em alfabetos não latinos e permite investigar falhas de descoberta em qualquer localidade. Uberlândia + Barber é somente um caso de reprodução. O timeout de produção ainda não foi demonstrado como resolvido.

## Arquivos de execução

Atualizar server.cjs e adicionar overpass.cjs na mesma pasta. app.js, index.html, agent.cjs e niches.cjs permanecem sem alteração.

## Comportamento

A consulta, a área geográfica, os seletores e a alternativa por nomes são preservados. A comparação de nomes e as chaves de cache de localidade/discovery passam a preservar letras e números Unicode. Antes, cidades como 北京 e 東京 normalizavam para a mesma string vazia, podendo reutilizar a localidade ou descoberta errada. As versões dessas chaves foram incrementadas para não reutilizar entradas antigas; o cache da classificação não foi alterado. Há uma tentativa por consulta, 45 s para execução Overpass, 15 s para conexão TCP/TLS e 65 s para a resposta completa. O novo prazo de conexão e a mudança de fetch para node:http/node:https precisam ser avaliados no Render.

GET /api/diagnostics/overpass usa a autenticação existente e retorna o endpoint efetivo, a fonte de configuração, o geocodificador, os candidatos e a localidade escolhida na última descoberta sem cache, o bounding box, areaId, a consulta QL e seus tempos por fase. Não retorna a chave LocationIQ. Um cache de descoberta pode impedir a geração de uma nova consulta; o diagnóstico indica cacheHit.

?probe=1 executa uma consulta mínima, limitada a 10 s, com intervalo de 30 s e bloqueio durante uma pesquisa. Seu sucesso confirma apenas conectividade, não a consulta de empresas.

connection_error e connection_timeout indicam falha antes de TCP/TLS pronto. response_timeout com awaiting_headers indica espera após conexão, ainda sem distinguir fila de execução; reading_body indica transferência. query_timeout exige um remark de timeout informado pelo Overpass. HTTP de erro, JSON inválido e consulta incompleta são falhas separadas. Uma lista vazia válida é empty. Resultados parciais com remark nunca são aceitos como sucesso nem cacheados como descoberta concluída.

## Validação

node --check server.cjs
node --check overpass.cjs
node --test test/*.test.cjs

Os 25 testes passaram: transporte com servidores e sockets locais controlados, mais regressões de localização/discovery com fixtures explicitamente identificadas. Incluem nomes em português, inglês, japonês, chinês e árabe, escopo por área/bounding box, cache, falhas, classificação e autenticação do diagnóstico. Não são prova de resolução no Overpass ou no Render. A consulta exata e as funções de classificação foram comparadas com o código original e preservadas.

## Validação de produção ainda pendente

Depois de implantar em ambiente de teste, reproduzir Uberlândia + Barber com a mesma área e coletar o diagnóstico autenticado. Conferir displayName, osmType/osmId, boundingbox, scope, endpoint e fases. Confirmar OVERPASS_URL no Render: o padrão existente continua sendo overpass-api.de, enquanto o endpoint informado pelo usuário é overpass.private.coffee. Nenhuma chave deve ser colocada no código ou enviada pela conversa.

A rota estava ausente no server.cjs original. Os 65 s do frontend são usados pela IA; pesquisas são jobs com HTTP 202 e polling de 20 s por requisição. A verificação de sites começa depois da descoberta e não explica o timeout anterior.

## Evidências externas desta investigação

Consultas reais ao Nominatim retornaram localidades para Uberlândia (Brasil, relation 314875), Saskatoon (Canadá, relation 4189345) e Sydney (Austrália, relation 5750005). Esses resultados não comprovam a escolha do LocationIQ no Render.

A consulta original de Barber para a área 3600314875 enviada ao endpoint private.coffee deste ambiente expirou após 55 s sem headers/corpo HTTP. Um GET de status subsequente também não conectou no prazo de 3 s. O status de overpass-api.de respondeu HTTP 406 em aproximadamente 1 s. Nenhum desses resultados é uma resposta vazia de empresas nem comprova a causa do timeout no Render. Não foi reduzida a área nem trocado automaticamente o endpoint.

A validação real de discovery em várias regiões continua pendente; não há resultados de empresas simuladas apresentados como prova de correção em produção. Não houve bypass de autenticação, acesso a dados privados ou mudança no agente.
