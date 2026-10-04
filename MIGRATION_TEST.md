# Teste fora do Render com orçamento zero

## Verificação em 4 de outubro de 2026

Não houve migração nem correção comprovada do timeout. As condições atuais não permitem recomendar cadastro novo nesses fornecedores como totalmente gratuito:

- Koyeb: existe uma instância free, mas a FAQ informa cartão obrigatório, pré-autorização de US$ 29 e cobrança proporcional do plano selecionado no cadastro (Pro no fluxo descrito). https://www.koyeb.com/docs/faqs/pricing e https://www.koyeb.com/docs/reference/instances . Não foi criada conta ou contratado plano.
- Hugging Face: CPU Basic não tem tarifa horária, mas a documentação atual exige plano pago para criar Spaces de compute Docker/Gradio. Static Spaces são gratuitos e não executam este backend Node.js. https://huggingface.co/docs/hub/spaces-overview . Não foi criado Space.

Antes de configurar qualquer outro fornecedor, conferir acesso realmente gratuito para a conta e autorização das requisições de saída. Sem acesso autorizado a uma conta de hospedagem elegível, não existe deploy externo realizado.

## Correção de portabilidade

O código anterior considerava hospedagem apenas quando RENDER=true. Fora do Render ele escutava em 127.0.0.1, em vez de aceitar conexões do proxy da plataforma, e não aplicava a exigência de senha hospedada. Isso impediria uma migração correta, mas NÃO explica o timeout das requisições de saída no Render.

hosting.cjs centraliza essa configuração. APP_HOSTED=true habilita modo hospedado em qualquer plataforma Node.js. APP_ORIGIN deve conter a URL pública, sem credenciais. PORT deve ser a porta fornecida pela plataforma. O servidor escuta em 0.0.0.0 e exige APP_PASSWORD com pelo menos 16 caracteres. RENDER=true continua funcionando automaticamente e não pode ser desprotegido por APP_HOSTED=false. Nenhuma senha/chave foi inserida no código.

Arquivos de execução atualizados: server.cjs e hosting.cjs. Agente, categorias, frontend, QL e limites geográficos permanecem preservados. A configuração local segue restrita a loopback.

55 testes locais passaram. Um processo Node real confirmou bind 0.0.0.0, /health HTTP 200 e diagnóstico HTTP 401 sem autenticação. Outro processo recusou início hospedado sem senha. Esses testes confirmam portabilidade e proteção, não acesso real ao Overpass fora do Render.

## Diagnóstico pelo GitHub Actions

.github/workflows/overpass-network.yml define uma rodada curta num runner ubuntu-latest. Permissões somente contents:read; checkout não persiste credenciais; nenhum secret é referenciado. Não cria servidor público, não hospeda o site e não substitui o Render. É apenas um teste independente de rede numa terceira infraestrutura.

O workflow executa 55 regressões e os probes reais existentes com limite de 6 s por requisição, sem consulta pesada, loops ou envio de credenciais. Resultados ficam no log NETWORK_CHECK. Não interpreta sucesso do workflow como sucesso da rede: os probes podem registrar timeout/HTTP 504 e o job terminar normalmente. Só analisar os registros validOverpass/outcome/httpStatus.

O evento push é restrito à branch de teste e à mudança desse arquivo; demais commits não repetem os probes automaticamente. workflow_dispatch também existe para uso manual. O repositório público usa os runners padrão; não são solicitados runners pagos ou infraestrutura adicional. A conexão GitHub precisa autorizar escrever arquivos de workflow para publicá-lo. Se essa permissão faltar, registrar a rejeição e não afirmar que o teste foi executado.

Somente um probe válido permite passar à busca REAL de empresas com a mesma QL completa. Uma resposta vazia válida, timeout e conexão recusada continuam distintos. Só migrar depois de discovery real bem-sucedida em várias localidades, inclusive validação de área e autenticação na nova hospedagem.


## Resultado REAL fora do Render — 4 de outubro, 17:20 UTC

Workflow https://github.com/eriksmoura14-ai/prospect-ai/actions/runs/37220127396 , job 111488599765, commit ce50a14dad4bc45d30bd046ecbed9baf29310f87. Os 55 testes passaram no runner e o job completou; isso não significa disponibilidade dos endpoints.

- private.coffee transporte nativo: TLS/conexão 914 ms; aguardou headers sem bytes e expirou em 6013 ms.
- fetch independente: expirou em 6003 ms.
- curl GET: TLS 0.256340 s, HTTP 000, sem primeiro byte, exit 28 em 6.001601 s.
- curl POST: TLS 0.258332 s, HTTP 000, sem primeiro byte, exit 28 em 6.002164 s.
- curl GET VK Maps: TLS 0.606519 s, HTTP 000, exit 28 em 6.002353 s.

Nenhuma consulta pesada foi enviada, pois nenhum probe obteve resposta válida. Não é prova de que todo fornecedor falha, nem determina o motivo exato de retenção no operador/caminho. Demonstra que a falha atual também se reproduz fora do Render. A migração não foi realizada: os fornecedores avaliados exigem requisitos de pagamento incompatíveis com cadastro novo a custo zero, não há conta de outra hospedagem vinculada, e os endpoints não responderam no teste externo. A produção e a main permanecem preservadas. Não há descoberta de empresas comprovada como resolvida.
