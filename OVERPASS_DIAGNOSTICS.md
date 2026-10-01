# Diagnóstico da descoberta de empresas

Esta alteração permite investigar o timeout em Uberlândia + Barber. Não demonstra que o timeout em produção foi resolvido.

## Arquivos de execução

Atualizar server.cjs e adicionar overpass.cjs na mesma pasta. app.js, index.html, agent.cjs e niches.cjs permanecem sem alteração.

## Comportamento

A consulta, a seleção da localidade, a área geográfica, os seletores e a alternativa por nomes são preservados. Há uma tentativa por consulta, 45 s para execução Overpass, 15 s para conexão TCP/TLS e 65 s para a resposta completa. O novo prazo de conexão e a mudança de fetch para node:http/node:https precisam ser avaliados no Render.

GET /api/diagnostics/overpass usa a autenticação existente e retorna o endpoint efetivo, a fonte de configuração, o geocodificador, os candidatos e a localidade escolhida na última descoberta sem cache, o bounding box, areaId, a consulta QL e seus tempos por fase. Não retorna a chave LocationIQ. Um cache de descoberta pode impedir a geração de uma nova consulta; o diagnóstico indica cacheHit.

?probe=1 executa uma consulta mínima, limitada a 10 s, com intervalo de 30 s e bloqueio durante uma pesquisa. Seu sucesso confirma apenas conectividade, não a consulta de empresas.

connection_error e connection_timeout indicam falha antes de TCP/TLS pronto. response_timeout com awaiting_headers indica espera após conexão, ainda sem distinguir fila de execução; reading_body indica transferência. query_timeout exige um remark de timeout informado pelo Overpass. HTTP de erro, JSON inválido e consulta incompleta são falhas separadas. Uma lista vazia válida é empty. Resultados parciais com remark nunca são aceitos como sucesso nem cacheados como descoberta concluída.

## Validação

node --check server.cjs
node --check overpass.cjs
node --test test/overpass.test.cjs

Os 15 testes passaram com servidores e sockets locais controlados. Não são prova de resolução no Overpass ou no Render. A consulta exata e as funções de classificação foram comparadas com o código original e preservadas.

## Validação de produção ainda pendente

Depois de implantar em ambiente de teste, reproduzir Uberlândia + Barber com a mesma área e coletar o diagnóstico autenticado. Conferir displayName, osmType/osmId, boundingbox, scope, endpoint e fases. Confirmar OVERPASS_URL no Render: o padrão existente continua sendo overpass-api.de, enquanto o endpoint informado pelo usuário é overpass.private.coffee. Nenhuma chave deve ser colocada no código ou enviada pela conversa.

A rota estava ausente no server.cjs original. Os 65 s do frontend são usados pela IA; pesquisas são jobs com HTTP 202 e polling de 20 s por requisição. A verificação de sites começa depois da descoberta e não explica o timeout anterior.
