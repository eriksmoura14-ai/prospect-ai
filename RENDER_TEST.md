# Validação em um serviço de teste do Render

Esta configuração ainda precisa ser aplicada no Render. Criar a configuração no GitHub não cria um serviço nem implanta a aplicação.

O arquivo render.test.yaml define somente um serviço novo, prospect-ai-discovery-test, usando a branch do PR. Plano free, auto-deploy desligado, verificação de sintaxe e os 45 testes obrigatórios antes de iniciar. Nenhum serviço de produção está definido no arquivo.

No fluxo de criação de Blueprint do Render, selecionar este repositório, a branch codex/overpass-timeout-diagnostics e o caminho render.test.yaml (é possível personalizar o caminho durante a configuração). Conferir o resumo de recursos antes de aplicar. LOCATIONIQ_KEY deve ser configurada diretamente no Render, com a credencial autorizada usada pela aplicação, sem colocá-la no código ou na conversa. O Render gera APP_PASSWORD; o usuário admin e essa senha protegem a aplicação e o diagnóstico. O login deve ser feito diretamente no serviço de teste. GROQ_API_KEY é opcional para validar o agente e deve ser configurada somente no Render quando necessária.

## Sequência de validação

1. Conferir o build e /health do novo serviço.
2. Fazer uma busca manual em uma cidade, com país/estado quando necessário.
3. Depois da busca, abrir /api/diagnostics/overpass na mesma sessão autenticada. Esse acesso não repete a consulta pesada.
4. Registrar a localidade escolhida, osmType/osmId, boundingbox, areaId/scope, endpoint, cacheHit, consulta e tempos/fases. Não registrar chaves ou headers de autenticação.
5. Se necessário, usar ?probe=1 uma vez após a busca. O teste mínimo tem até 10 s e não confirma a descoberta de empresas. Respeitar o intervalo de 30 s e não executar durante uma busca.
6. Testar outras regiões, uma busca de cada vez: Brasil, Canadá, Austrália e localidades com nomes em alfabetos não latinos. A escolha concreta deve ser compatível com o objeto devolvido pelo LocationIQ, não somente com Nominatim.

Usar apenas informações comerciais públicas e acesso autorizado. Não contornar login, restrições de sites ou limites dos serviços. Não reduzir a área para transformar um timeout em aparente sucesso.

## Critérios

Validar localidade e área antes de interpretar a quantidade. empty é uma resposta válida vazia, mas não significa que não existam empresas na cidade. connection_error/connection_timeout indicam falha antes de TCP/TLS pronto. response_timeout em awaiting_headers não distingue sozinho fila e execução; reading_body indica transferência. query_timeout exige remark do Overpass. Erros e respostas incompletas não podem ser usados como resultados completos.

O transporte novo e os prazos devem ser confirmados no Render. A correção Unicode foi validada por regressões locais, mas o timeout de produção ainda não foi demonstrado como resolvido. Manter o PR em rascunho até concluir essa validação. Não há merge ou deploy de produção autorizado por este arquivo.

Referência da configuração: https://render.com/docs/blueprint-spec

## Atualizar o serviço de teste para validar a recuperação

Depois de publicar o commit de recuperação, usar Manual sync no Blueprint prospect-ai-teste. O serviço de teste deve conter OVERPASS_URL=https://overpass.private.coffee/api/interpreter e OVERPASS_FALLBACK_URLS=https://maps.mail.ru/osm/tools/overpass/api/interpreter. Esses valores são URLs públicas, sem chaves. Se o serviço não implantar o commit novo pela sincronização, usar Manual Deploy → Deploy latest commit somente em prospect-ai-discovery-test. Não atualizar o serviço de produção.

Conferir nos logs a passagem dos 45 testes e o commit implantado. Fazer uma busca manual e coletar /api/diagnostics/overpass. Verificar todas as tentativas purpose=probe/businesses e seus endpoints, além do resultado final. Um probe positivo não prova descoberta completa; uma falha rápida também não prova inexistência de empresas.

O diagnóstico enviado até agora indicou geocoder=Nominatim. Para validar o mesmo provedor da produção, configurar LOCATIONIQ_KEY diretamente no Render usando a credencial já autorizada, sem enviar seu valor à conversa. Não é necessário modificar o código ou o agente para isso.


## Comparação explícita de transporte

Sincronizar o Blueprint para aplicar OVERPASS_HTTP_METHOD=GET e OVERPASS_IP_FAMILY=4, além da alternativa VK Maps acima. Depois usar Manual Deploy → Deploy latest commit no serviço prospect-ai-discovery-test. Conferir commit e passagem dos 45 testes. O diagnóstico deve mostrar httpMethod=GET e ipFamily=4. A aplicação mantém POST/automático como padrões fora dessa configuração de teste.

Esta rodada é experimental: nenhum endpoint alternativo foi comprovado disponível no Render. A evidência anterior já mostrou falha de probes mínimos, sem envio da consulta de empresas. Não promover à produção sem descoberta real bem-sucedida e validação de área/filtros.
