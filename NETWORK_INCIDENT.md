# Bloqueio de descoberta: evidências e teste independente

## Estado em 2026-10-01

O timeout não está resolvido. Não houve resposta real de empresas nos testes descritos. Não foi feita alteração adicional de runtime nesta rodada, pois a evidência não justifica outra troca especulativa de transporte.

Último diagnóstico enviado pelo usuário, serviço prospect-ai-discovery-test:
- Configuração nova aplicada: GET, família IPv4, private.coffee e VK Maps.
- private.coffee: IP 193.219.97.30, TCP 199 ms, TLS/conexão 390 ms, sem headers/bytes até 10004 ms.
- VK Maps: IP 95.163.216.90, TCP 397 ms, TLS/conexão 792 ms, sem headers/bytes até 10001 ms.
- Ambas as requisições eram probes mínimos. Não foi enviada consulta pesada.
- Uberlândia foi selecionada como relation 314875, área 3600314875, limite administrativo completo. O provedor observado foi Nominatim.
- O texto copiado pelo navegador contém campos/QL traduzidos e repetições; não constitui prova de alteração da QL no servidor. O código envia out count.

Esses fatos demonstram falha de resposta mesmo em teste mínimo, não uma resposta vazia nem execução lenta comprovada da busca de empresas. GET/IPv4 não resolveu. Não é possível distinguir operador de caminho de rede apenas com awaiting_headers.

## Testes externos desta rodada

Um GET mínimo ao private.coffee, com prazo total de 6 s, também expirou sem headers/corpo. Este ambiente usa proxy HTTP; sua rota não é a mesma do Render.

A alternativa Mapsource foi avaliada pela documentação e status público, sem autenticação. https://api.mapsource.io/api/status retornou status=degraded e overpass.complete=false; o serviço informou uma base OSM incompleta e objetos faltantes. Não foi configurado como alternativa, pois isso poderia reduzir cobertura. Esse estado é transitório e deve ser consultado novamente antes de qualquer escolha.

Os 45 testes locais passaram novamente. Eles verificam implementação, não disponibilidade pública. Agente, classificação, área e seletores não foram alterados nesta rodada.

## Teste para o suporte Render executar

Executar no MESMO serviço/região, e comparar em outra máquina. São somente quatro probes mínimos públicos, sequenciais, sem repetição automática. Máximo de 6 s por requisição. Não colocar senhas/chaves no comando. Não exige login no Prospect AI e não usa arquivos da aplicação.

```sh
curl --silent --show-error --connect-timeout 3 --max-time 6 --get \
  --data-urlencode 'data=[out:json][timeout:5][maxsize:16777216];node(1);out count;' \
  --user-agent 'ProspectAI-network-diagnostic/1.0' \
  --write-out '\nhttp=%{http_code} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} first_byte=%{time_starttransfer} total=%{time_total}\n' \
  https://overpass.private.coffee/api/interpreter

curl --silent --show-error --connect-timeout 3 --max-time 6 \
  --data-urlencode 'data=[out:json][timeout:5][maxsize:16777216];node(1);out count;' \
  --user-agent 'ProspectAI-network-diagnostic/1.0' \
  --write-out '\nhttp=%{http_code} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} first_byte=%{time_starttransfer} total=%{time_total}\n' \
  https://overpass.private.coffee/api/interpreter
```

Repetir os dois comandos uma única vez com URL https://maps.mail.ru/osm/tools/overpass/api/interpreter. curl preserva o proxy do ambiente e a verificação TLS. Não usar -k, IP fixo, troca de domínio, bypass ou loops de tentativas.

## Texto preparado para chamado (não enviado)

O serviço Node.js prospect-ai-discovery-test, no Render, resolve DNS e completa TCP/TLS contra duas instâncias públicas Overpass, mas não recebe cabeçalhos HTTP em 10 segundos mesmo para uma consulta mínima node(1);out count;. Já comparamos POST e GET, e GET com IPv4 explícito, sem sucesso. Os IPs e tempos acima constam do diagnóstico real. Precisamos comparar curl independente da aplicação no mesmo serviço/região e verificar se há falha de saída, resposta retida ou bloqueio pelo operador a esse IP de origem. Não solicitamos bypass de limites nem dados privados. Qual o resultado desses probes na rede do serviço e qual o IP/região de saída para investigar com os operadores?

## Acesso que falta e critério de conclusão

O agente tem acesso ao GitHub, mas nenhuma ferramenta Render está exposta nesta sessão. Não possui Shell autenticado no serviço, logs de rede da plataforma ou credenciais autorizadas para um serviço mundial alternativo. Aumentar permissões do GitHub não fornece esses acessos.

Próximo passo concreto: o suporte Render executar o teste independente acima no serviço e comparar a rota. Se for falha da plataforma, corrigir o acesso/região com suporte. Se for indisponibilidade dos operadores, é necessário um endpoint mundial operacional autorizado (serviço próprio ou contratado). O código aceita OVERPASS_URL; manter requisitos de segurança e cobertura ao escolher o operador.

Só declarar correção depois de uma consulta real de empresas completa, sem remark de erro, mantendo área/seletores, seguida de validação em mais de um país. Um probe positivo ou testes locais sozinhos não bastam. Não houve envio de chamado, contratação, merge na main ou deploy de produção.


## Atualização: execução independente dentro do Render (22:34–22:35 UTC)

O acesso Render foi conectado posteriormente; a seção anterior sobre ausência de ferramentas descreve o estado antes dessa conexão. Agora há acesso a serviços, deploys e logs, mas não Shell/MCP de execução geral nem ferramentas de atendimento ao suporte.

Foi implantado b9e30d871d92b1ab421b447cf956b0f95408d008 exclusivamente em prospect-ai-discovery-test (Oregon, free). server.cjs inicia network-check.cjs em segundo plano apenas nesse serviço e quando OVERPASS_NETWORK_CHECK=1. Requisições são mínimas, sequenciais, com prazo 6 s, sem credenciais e sem busca de empresas.

Resultados reais registrados nos logs NETWORK_CHECK:
- Transporte nativo: private.coffee conecta TLS em 496 ms, expira sem headers em 6094 ms.
- fetch independente: expira após 6005 ms.
- curl GET: TCP 0.198214 s, TLS 0.405156 s, HTTP 000, primeiro byte 0, expira em 6.001065 s (exit 28).
- curl POST: TCP 0.192904 s, TLS 0.481296 s, HTTP 000, primeiro byte 0, expira em 6.001858 s (exit 28).
- curl GET VK Maps: HTTP 504 recebido em 1.250185 s, não é JSON válido de empresas.

O teste completou às 22:35:03 UTC. A atualização de variável já inicia deploy no Render, mesmo com auto-deploy por commit desativado; a solicitação adicional iniciou um segundo deploy/rodada. Não repetir trigger_deploy após futuras atualizações de variável. OVERPASS_NETWORK_CHECK foi definido como 0 para evitar novas rodadas em reinícios; o Render iniciou a implantação dessa desativação.

Os 45 testes locais passaram após o acréscimo do diagnóstico. O transporte original de empresas, QL, localidade, escopo, agente e classificação foram preservados. Arquivos de código desta rodada: server.cjs e network-check.cjs. Nenhuma alteração no serviço de produção.

Conclusão: a falha é reproduzível no mesmo Render por cliente independente do aplicativo; trocar o transporte do Prospect AI não resolveu. Não prova se private.coffee está retendo requisições por fila ou origem; VK Maps devolve uma falha de gateway. Não houve resultado de empresas, portanto correção real continua pendente. Anexar esses resultados ao chamado existente do Render. Se não houver correção do acesso/operador, falta um endpoint mundial operacional autorizado para configurar OVERPASS_URL, sem redução de cobertura.


## Orçamento zero e teste gratuito em Frankfurt (22:49 UTC)

O usuário definiu somente opções gratuitas. Não contratar fornecedores nem mudar plano para pago. Foi criado prospect-ai-eu-test, srv-dave6had0e5s73flcf9g, explicitamente plan=free, região frankfurt, branch de teste, deploy automático desligado. Não é o serviço de produção. A instância adicional usa a franquia de horas dos serviços gratuitos do workspace; não foi contratado recurso pago. A senha foi gerada e armazenada somente no Environment desse serviço, sem registro no repositório ou relatório.

A comparação de rede foi feita sobre be8da14ebaa7bb73413feba158ab76ae157a603c, com os 50 testes no build e deploy live. Requisições mínimas sequenciais, limite 6 s, nenhum resultado de empresas simulado:
- private.coffee nativo: TLS em 218 ms, sem headers, expira em 6097 ms.
- fetch: expira em 6004 ms.
- curl GET: TCP 0.013087 s, TLS 0.190426 s, HTTP 000, expira em 6.001952 s.
- curl POST: TCP 0.016392 s, TLS 0.204324 s, HTTP 000, expira em 6.001428 s.
- curl VK Maps: TCP 0.089716 s, TLS 0.254562 s, HTTP 000, expira em 6.001063 s.

O teste terminou às 22:49:34 UTC. OVERPASS_NETWORK_CHECK foi definido como 0 posteriormente para não repetir em reinícios. Nenhuma busca pesada foi enviada, pois nenhum probe confirmou disponibilidade. Não foi reduzida a área ou trocado o geocodificador/regras do produto.

Conclusão: a falha é reproduzível em Oregon e Frankfurt mesmo em clientes independentes; a troca gratuita de região não resolveu nesta rodada. O orçamento não permite escolher o serviço comercial avaliado na documentação. Nenhuma alternativa gratuita mundial foi comprovada disponível para este aplicativo; serviços gratuitos com cadastro devem ter elegibilidade/termos e acesso confirmados antes de configuração. Anexar esses dados ao chamado EXISTENTE no Render e investigar também disponibilidade dos operadores. Não repetir deploys/timeout sem nova evidência. O agente continua sem ferramenta de atendimento para anexar ao chamado, apesar do acesso a deploys/logs.
