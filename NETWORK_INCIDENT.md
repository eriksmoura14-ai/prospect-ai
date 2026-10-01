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
