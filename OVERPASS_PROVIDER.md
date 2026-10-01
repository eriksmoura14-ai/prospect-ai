# Troca para um serviço Overpass autenticado

## Estado

Esta integração prepara uma alternativa à indisponibilidade pública. Não provisiona uma conta, não contrata um plano e não prova descoberta real. O endpoint público atual continua configurado até existir uma credencial autorizada e um fornecedor escolhido.

O diagnóstico executado no próprio Render reproduziu a falha com curl GET/POST no private.coffee e HTTP 504 no VK Maps. Aumentar o prazo ou trocar o transporte não solucionou. Consultas, área administrativa/bounding box completos, agente e regras de classificação são preservados.

## Integração

- OVERPASS_URL: endpoint HTTPS sem chave na URL.
- OVERPASS_API_KEY: chave inserida SOMENTE no Environment do serviço Render. Não colocar no GitHub, Blueprint, conversa ou URL.
- A chave segue como Authorization: Bearer exclusivamente ao endpoint primário, inclusive no probe mínimo. Não é enviada a endpoints alternativos, mesmo no mesmo host com outro caminho.
- A aplicação não segue redirects do transporte nativo; a chave não é reenviada a outro destino.
- HTTP 401/403/429 interrompe a execução e não aciona alternativa para contornar autenticação ou quota.
- /api/diagnostics/overpass informa apenas authenticationConfigured; nunca o valor. Remarks que reflitam a chave são redigidos antes do diagnóstico/log.
- A autenticação exige HTTPS e rejeita quebras de linha. Sem OVERPASS_API_KEY, o comportamento público existente é preservado.

## Fornecedor avaliado: Overspan (opção, não contratação)

Documentação pública: https://overspan.dev/ . Anuncia base OSM mundial, áreas geradas, QL padrão, acesso de IPs de nuvem e Bearer. Plano Indie anunciado: US$ 19/mês, 50 mil requisições/mês, timeout máximo 60 s e memória 512 MB. Os limites de consulta atuais de 45 s/16 MB cabem nesses limites anunciados. Preço, termos e impostos devem ser conferidos antes da contratação.

Endpoint: https://api.overspan.dev/api/interpreter . Um GET mínimo não autenticado deste ambiente respondeu HTTP 401/missing_key em aproximadamente 0,4 s. Isso prova acesso ao gateway deste ambiente e exigência de chave; NÃO comprova disponibilidade da consulta autenticada, completude efetiva do catálogo ou acesso pelo Render. Checkout requer ação do titular e fornece chave por e-mail; o agente não possui acesso ao pagamento, e-mail ou credencial.

Não foi usada a alternativa Mapsource: na avaliação anterior, seu status reportava base OSM incompleta. Não aceitar um serviço regional ou incompleto como substituição mundial silenciosa.

## Ativação depois de escolher e obter a credencial

No serviço de TESTE prospect-ai-discovery-test, usar Environment:

1. OVERPASS_URL=https://api.overspan.dev/api/interpreter (somente se esse fornecedor for escolhido).
2. OVERPASS_API_KEY: inserir a chave diretamente na interface Render, sem enviá-la ao agente.
3. OVERPASS_HTTP_METHOD=POST e OVERPASS_IP_FAMILY=0 para começar com os padrões do cliente.
4. OVERPASS_FALLBACK_URLS vazio durante a validação, isolando o resultado do serviço contratado.
5. OVERPASS_NETWORK_CHECK=0; o diagnóstico antigo testa somente endpoints públicos e não valida esse fornecedor.

Salvar as variáveis já inicia deploy no Render. Não solicitar outro deploy em seguida. O Blueprint de teste contém os valores públicos anteriores: uma sincronização pode sobrescrever esses valores; ajustar o Blueprint ao fornecedor escolhido antes de sincronizar novamente. Não declarar a chave como value no YAML.

Verificar deploy, authenticationConfigured=true e probe mínimo. Depois realizar descoberta REAL em várias localidades/países, conferindo geocodificador, área/bounding box, QL completa, ausência de remark e resultados reais. Probe, HTTP 401 e testes controlados não são prova de resolução. Erro ou lista vazia válida têm diagnósticos distintos. Não ativar a produção sem essa validação.

## Arquivos e testes

Atualizados server.cjs e overpass.cjs, testes em test/overpass.test.cjs e test/overpass-recovery.test.cjs. 50 testes locais verificam regressões globais, transporte, recuperação e isolamento da credencial. Os testes de autenticação usam fixtures/mocks explicitamente controlados, não contas remotas. agent.cjs, niches.cjs, app.js e index.html continuam idênticos aos originais.
