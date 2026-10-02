# Localização global e diagnóstico da descoberta de empresas

Esta alteração corrige colisões de cache e seleção de nomes de cidades em alfabetos não latinos e permite investigar falhas de descoberta em qualquer localidade. Uberlândia + Barber é somente um caso de reprodução. O timeout de produção ainda não foi demonstrado como resolvido.

## Arquivos de execução

Atualizar server.cjs e adicionar overpass.cjs na mesma pasta. app.js, index.html, agent.cjs e niches.cjs permanecem sem alteração.

## Comportamento

A consulta, a área geográfica, os seletores e a alternativa por nomes são preservados. A comparação de nomes e as chaves de cache de localidade/discovery passam a preservar letras e números Unicode. Antes, cidades como 北京 e 東京 normalizavam para a mesma string vazia, podendo reutilizar a localidade ou descoberta errada. As versões dessas chaves foram incrementadas para não reutilizar entradas antigas; o cache da classificação não foi alterado. Há uma tentativa pesada por endpoint configurado e por etapa (categorias/nomes), 45 s para execução Overpass, 15 s para conexão TCP/TLS e 65 s para a resposta completa de cada consulta pesada. O novo prazo de conexão e a mudança de fetch para node:http/node:https precisam ser avaliados no Render.

GET /api/diagnostics/overpass usa a autenticação existente e retorna o endpoint efetivo, a fonte de configuração, o geocodificador, os candidatos e a localidade escolhida na última descoberta sem cache, o bounding box, areaId, a consulta QL e seus tempos por fase. Não retorna a chave LocationIQ. Um cache de descoberta pode impedir a geração de uma nova consulta; o diagnóstico indica cacheHit.

?probe=1 executa uma consulta mínima, limitada a 10 s, com intervalo de 30 s e bloqueio durante uma pesquisa. Seu sucesso confirma apenas conectividade, não a consulta de empresas.

connection_error e connection_timeout indicam falha antes de TCP/TLS pronto. response_timeout com awaiting_headers indica espera após conexão, ainda sem distinguir fila de execução; reading_body indica transferência. query_timeout exige um remark de timeout informado pelo Overpass. HTTP de erro, JSON inválido e consulta incompleta são falhas separadas. Uma lista vazia válida é empty. Resultados parciais com remark nunca são aceitos como sucesso nem cacheados como descoberta concluída.

## Validação

node --check server.cjs
node --check overpass.cjs
node --test test/*.test.cjs

Os 45 testes passaram: transporte com servidores e sockets locais controlados, mais regressões de localização/discovery com fixtures explicitamente identificadas. Incluem nomes em português, inglês, japonês, chinês e árabe, escopo por área/bounding box, cache, falhas, classificação e autenticação do diagnóstico. Não são prova de resolução no Overpass ou no Render. A consulta exata e as funções de classificação foram comparadas com o código original e preservadas.

## Validação de produção ainda pendente

Depois de implantar em ambiente de teste, reproduzir Uberlândia + Barber com a mesma área e coletar o diagnóstico autenticado. Conferir displayName, osmType/osmId, boundingbox, scope, endpoint e fases. Confirmar OVERPASS_URL no Render: o padrão existente continua sendo overpass-api.de, enquanto o endpoint informado pelo usuário é overpass.private.coffee. Nenhuma chave deve ser colocada no código ou enviada pela conversa.

A rota estava ausente no server.cjs original. Os 65 s do frontend são usados pela IA; pesquisas são jobs com HTTP 202 e polling de 20 s por requisição. A verificação de sites começa depois da descoberta e não explica o timeout anterior.

## Evidências externas desta investigação

Consultas reais ao Nominatim retornaram localidades para Uberlândia (Brasil, relation 314875), Saskatoon (Canadá, relation 4189345) e Sydney (Austrália, relation 5750005). Esses resultados não comprovam a escolha do LocationIQ no Render.

A consulta original de Barber para a área 3600314875 enviada ao endpoint private.coffee deste ambiente expirou após 55 s sem headers/corpo HTTP. Um GET de status subsequente também não conectou no prazo de 3 s. O status de overpass-api.de respondeu HTTP 406 em aproximadamente 1 s. Nenhum desses resultados é uma resposta vazia de empresas nem comprova a causa do timeout no Render. Não foi reduzida a área nem trocado automaticamente o endpoint.

A validação real de discovery em várias regiões continua pendente; não há resultados de empresas simuladas apresentados como prova de correção em produção. Não houve bypass de autenticação, acesso a dados privados ou mudança no agente.

## Recuperação após a evidência obtida no Render

O diagnóstico da busca real no serviço de teste selecionou Uberlândia, relation 314875 e área 3600314875. DNS concluiu em 31 ms, TCP em 226 ms e TCP/TLS em 454 ms. Não foram recebidos headers ou bytes de resposta até o prazo de 65003 ms. Isso identifica uma espera após conexão no endpoint private.coffee, mas não distingue fila, execução ou retenção da resposta pela rede. Não foi uma resposta vazia. O geocodificador dessa execução foi Nominatim; não confirma o comportamento do LocationIQ em produção.

A recuperação aplica-se a todas as localidades e nichos:
- Antes de uma consulta pesada, cada endpoint sem saúde recente recebe uma consulta mínima, com 5 s de execução, 5 s de conexão e 10 s total. Saúde positiva vale 60 s.
- Falha de conexão, espera sem headers e HTTP 502/503/504 permitem tentar a próxima alternativa explicitamente configurada em OVERPASS_FALLBACK_URLS (lista separada por vírgulas). Sem essa variável não existe alternativa automática.
- Cada alternativa recebe a QL original inteira, sem alterar a área, categorias ou termos. Não se fragmentam resultados nem aceitam respostas incompletas. Uma lista vazia válida não provoca troca de endpoint.
- Não há troca após HTTP 401, 403, 459, query_timeout informado, resposta incompleta, JSON inválido ou timeout durante transferência. Não se contornam autenticação ou limites de uso.
- Um endpoint com falha transitória entra em cooldown de 60 s, evitando insistência nas pesquisas seguintes. Não há trabalho automático em segundo plano.
- A recuperação pode adicionar tempo: cada probe tem 10 s e cada consulta pesada tem 65 s. Categorias e alternativa por nomes são etapas diferentes. Não há promessa de prazo total global de 65 s. Diagnósticos preservam todas as tentativas por endpoint/purpose/método.

O Blueprint de teste mantém private.coffee como primário e declara explicitamente https://maps.mail.ru/osm/tools/overpass/api/interpreter como alternativa mundial. Não há mudança silenciosa de endpoint na produção. Depois de sincronizar o Blueprint, conferir a presença de OVERPASS_FALLBACK_URLS no serviço de teste.

O diagnóstico inclui configuredEndpoints, maximumBusinessAttemptsPerStage e recovery. O probe manual mantém o primário por padrão; ?probe=1&target=fallback testa somente a primeira alternativa configurada, sem aceitar URLs fornecidas pelo navegador. As chamadas manuais respeitam o intervalo de 30 s.

As 45 verificações incluem fluxo de recuperação com sockets locais reais após 503 e testes unitários identificados como controlados. Consultas remotas deste ambiente não obtiveram empresas: private.coffee não respondeu nem ao probe mínimo em 10 s, e a alternativa alemã respondeu erros de gateway 503/504. Isso não prova a disponibilidade dessa alternativa no Render. O teste real após deploy permanece necessário; o timeout original não foi declarado resolvido.


## Teste de transporte e evidência mais recente

No Render, o probe mínimo do private.coffee completou TCP/TLS em 393 ms, mas expirou sem headers em 10003 ms. O probe do overpass-api.de falhou com ECONNREFUSED em 350 ms. Nenhuma consulta pesada foi enviada nessa execução. Isso demonstra falha mesmo com consulta mínima, mas não identifica se a retenção ocorre no operador ou na rede.

OVERPASS_HTTP_METHOD aceita POST (padrão) ou GET; GET envia a mesma QL integral no parâmetro data. OVERPASS_IP_FAMILY aceita 0 (automático, padrão), 4 ou 6. O Blueprint de teste usa GET e IPv4 explicitamente. O diagnóstico inclui httpMethod, ipFamily, endereços resolvidos, tentativas de conexão e endereço/família remotos quando disponíveis. Não é uma correção comprovada no Render.

O padrão sem OVERPASS_URL passa a ser private.coffee. A alternativa alemã foi retirada do Blueprint: a documentação pública recomenda serviço próprio ou pago para uso comercial. A alternativa VK Maps consta como instância mundial aberta para projetos na lista pública https://wiki.openstreetmap.org/wiki/Overpass_API ; verificar políticas antes de escalar o produto.

Neste ambiente, um GET mínimo à instância alemã retornou JSON válido, enquanto POSTs falharam. Isso motiva comparar transporte, sem provar o mesmo comportamento no Render. VK Maps não forneceu resultados: POST mínimo expirou e GET mínimo retornou HTTP 504. A descoberta real de empresas continua pendente. Os 45 testes locais verificam transporte, recuperação e regressões, não disponibilidade remota.
