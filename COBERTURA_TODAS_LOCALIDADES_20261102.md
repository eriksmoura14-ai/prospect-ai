# Varredura das fontes para todas as localidades — 02/11/2026

A passagem pelas fontes terminou para **todas as 152.970 localidades enumeradas
pelo Prospect AI**. As 16 partições globais da release Overture Places
`2026-10-21.0` foram examinadas. **Isso não conclui a meta de 50 empresas únicas
por cidade e não importa novas empresas no catálogo canônico.**

## Escopo e resultado medido

| Métrica | Resultado |
| --- | ---: |
| Localidades do aplicativo no cruzamento | 152.970 |
| Países/territórios com localidades enumeradas | 223 |
| Subdivisões com localidades enumeradas | 4.279 |
| Países oferecidos no seletor, incluindo os sem lista de cidades | 250 |
| Subdivisões oferecidas no seletor | 5.308 |
| Partições de fonte concluídas | 16/16 |
| Partições pendentes nesta passagem | 0 |
| Observações de fonte examinadas nos segmentos suportados | 8.700.650 |
| Observações reaproveitadas das 12 partições anteriores | 5.852.657 |
| Observações examinadas nas quatro partições restantes | 2.847.993 |
| Localidades com candidatos por endereço publicado | 58.378 |
| Localidades abaixo da meta com candidatos para conferir | 46.598 |
| Aumento de localidades com candidatos na etapa restante | 6.641 |
| Novas empresas únicas publicadas no catálogo | **0** |

O inventário foi regenerado pelo mesmo `locations.cjs` do aplicativo. As chaves,
nomes e coordenadas reproduziram a lista anterior; os fingerprints das 223
unidades de país no banco também foram conferidos. Não há seleção manual de
alguns países nem limite por cidade nesta etapa. As 27 opções de país sem uma
lista enumerada de cidades ficam identificadas no relatório; campos manuais
não formam um inventário mundial finito adicional.

Observações são registros da fonte, não empresas únicas reconciliadas nem
verificações de atividade, telefone, WhatsApp ou website. O cruzamento por nome
publicado exige país, estado e nome normalizado unívocos. Ele produz candidatos,
sem substituir um polígono revisado ou a deduplicação de estabelecimentos.

## Situação de cada localidade

| Situação após esta passagem | Localidades |
| --- | ---: |
| Já tinha pelo menos 50 empresas confirmadas no inventário | 12.923 |
| Candidatos exigem reconciliação geográfica e de identidade | 46.598 |
| Sem correspondência exata de endereço publicado nesta base | 93.228 |
| Nome publicado ambíguo no mesmo estado | 62 |
| Revisão do limite/identidade do território pendente | 159 |
| **Total do inventário** | **152.970** |

Sem correspondência não significa ausência de empresas. A fonte pode publicar
outro nome, omitir o estado ou a localidade, ou não conter um estabelecimento.
Esta passagem usa Overture e suas fontes componentes permitidas; não representa
uma consulta mundial exaustiva a todos os diretórios e operadores OSM.

A cobertura confirmada continua **12.923/152.970 = 8,4481%**; **140.047** locais
seguem abaixo da meta ou sem confirmação. O arquivo de cada local mantém a
situação anterior, a contagem de observações candidatas, os segmentos, as fontes
examinadas e a próxima ação. Não se distribuem empresas de cidades vizinhas,
observações duplicadas ou registros inventados para preencher a quantidade.

## Preservação e armazenamento

O acervo anterior permanece com **5.693.290 empresas únicas conservadoras**:
5.680.824 linhas canônicas ativas e 12.466 adicionais líquidos do legado. Esta
etapa conserva agregações de evidência de cobertura, não novas fichas comerciais.
As 294 publicações ativas e as 304 identidades de ativos conservaram o fingerprint
`6b456ff9a233e2f1c80e5729c1c5f1a3`. O milhão original também conservou o SHA-256
`f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`.

O resultado final está em um pacote público durável, não apenas em logs:

- [Pacote com todas as localidades, SQLite retomável, inventário, recibos e relatório](https://github.com/eriksmoura14-ai/prospect-ai/releases/download/catalog-sweep-41448772603/prospect-all-app-cities-source-sweep.zip).
- Tamanho: **22.335.692 bytes**.
- SHA-256: `a030c372ce50118ba59f93ee70f2953daa80d9215b0185d9b04e28f7007a7ed9`.
- `all-app-cities.ndjson.gz`: **3.058.529 bytes**, SHA-256
  `db7294ce94c08a0ff48bea62b857768783cd79c4219fbb23bafe47a74db95464`.
- SQLite de agregações: **52.314.112 bytes**; não contém contas de clientes.
- Manifesto de conclusão no Neon:
  `world-sweep:20261102:completed-1bfbffd7`.

Os arquivos de evidência não são enviados ao navegador pelo frontend, e não
substituem o catálogo de empresas usado nas buscas. Não houve deploy em produção,
alteração do layout, autenticação ou credenciais de clientes.

## Execução, correção e custo

A máquina interativa passou a devolver HTTP 503 do transporte `envoy` tanto
para S3 quanto para o GitHub. O código foi salvo pela integração conectada e a
execução foi transferida para um runner público gratuito. A primeira tentativa
remota revelou um defeito no cache: intervalos sobrepostos e a expulsão de blocos
repetiam downloads até atingir o orçamento por arquivo. Essa tentativa não
concluiu nenhuma partição e seu pacote parcial permanece identificado na evidência.
Seu status verde no workflow não foi tratado como sucesso de pesquisa.

A correção usa blocos fixos não sobrepostos e scratch temporário de uma única
partição, com SHA-256 conferido nas releituras. Mantém o limite original de
transferência e o cache de memória de 16 MiB. Uma passagem incompleta agora faz
o job falhar, depois de salvar seus checkpoints e o pacote parcial.

Um seed público com **780.591 agregações verificadas** reutilizou as 12 partições
locais. A importação real foi repetida sem acrescentar duplicatas; todas as
colunas foram comparadas com o banco mestre antes de remover somente uma cópia
de teste reconstruível. Os arquivos canônicos e o banco mestre foram preservados.

As quatro consultas restantes levaram **547.949 ms agregados** e receberam
**2.927.531.831 bytes de payload S3**. A leitura antecipada acessou todos os blocos
dessas quatro partições, uma vez por bloco; o scratch foi removido ao fechar cada
leitor. Esse número não inclui a tentativa anterior malsucedida, o pacote do
baseline, a instalação de dependências ou o clone do repositório. Não se declara
tráfego mundial zero ou apenas projetado. A identidade remota usou URL fixada,
ETag consistente e hashes de intervalos; não se alega verificação contra um
SHA-256 integral publicado para essas quatro fontes.

Foram usados somente o runner público padrão e os serviços gratuitos existentes.
Nenhum serviço pago foi contratado e nenhuma quota foi elevada. O Neon terminou
esta conferência com **211.959.808 bytes**, abaixo do guard de 230.686.720.

**125 testes Python passaram**, incluindo importação transacional do seed,
retomada sem duplicação, homônimos, não promoção de candidatos e releitura de
blocos maiores que o cache. Os workflows de autenticação e descoberta geográfica
passaram no código `1bfbffd79403fb0ab5a288aba0e5d60eee134454`.

[Execução concluída e publicação do pacote](https://github.com/eriksmoura14-ai/prospect-ai/actions/runs/41448772603).
O trabalho permanece na branch `codex/coverage-audit-policy-20261026`, no PR 38.

## Trabalho restante

A confirmação geográfica, conciliação com outras fontes e importação de novas
fichas comerciais ainda precisam ser executadas. Não se afirma que esta etapa
ampliou o acervo canônico ou que as pesquisas de produção já usam empresas novas.
Os locais sem evidência suficiente continuam pendentes, sem declarar esgotamento
mundial de fontes. A retomada do pacote está no [runbook](CITY_COVERAGE_RUNBOOK.md).
O job finito terminou; não existe coletor mundial contínuo ativo após ele.
