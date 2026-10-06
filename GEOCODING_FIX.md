# Reconhecimento de localidades — 2026-10-06

O backend anteriormente tentava uma única escrita da localidade e tratava todo
resultado descartado como cidade não encontrada. Não solicitava `statecode=1`
nem interpretava `address.state_code` do LocationIQ. A correspondência estadual
por nomes depende do idioma e da representação administrativa de cada provedor.

## Evidência externa

- O HTML público da produção contém a atribuição de LocationIQ. Não foi lida
  nenhuma chave nem usada uma conta de cliente para a investigação.
- Foram consultadas 31 combinações de cidade/subdivisão/país no Nominatim via
  HTTPS e proxy do ambiente, com intervalo mínimo de 1,2 s. A consulta
  `Lima, Municipalidad Metropolitana de Lima, Peru` retornou HTTP 200 e `[]`.
  `Lima, Peru` retornou a cidade com `ISO3166-2-lvl6=PE-LMA`.
- A documentação oficial do [LocationIQ](https://docs.locationiq.com/reference/search)
  descreve `statecode`, `namedetails`, `extratags` e `polygon_geojson`. Ela também
  informa que `source=nom` usa o seu cluster Nominatim e pode pós-processar dados;
  respostas desse cluster não precisam ser iguais às do Nominatim público.
- A função `locate()` corrigida executou consultas reais no Nominatim e localizou
  Araguari, Prata, Lima, New York City, Tokyo, Cairo e A dos Cunhados. Lima usou
  a segunda escrita; os sete resultados passaram pelo filtro geográfico usado
  pelo Geoapify. O polígono de Lima é a relação municipal `1944756`, sem redução
  de vértices. Esses testes não executaram consultas de empresas.

As primeiras 30 outras consultas retornaram localidades aceitas. Portanto, a
investigação reproduziu uma classe de falha, mas não estabeleceu que Lima ou
essa classe seja a causa da maioria dos erros relatados em produção. Faltaram
os nomes das cidades que falharam e uma busca autenticada no ambiente publicado.

## Correção

- Solicita nomes alternativos e códigos administrativos. Confere os códigos
  ISO em diferentes níveis, o código estadual normalizado do LocationIQ e o
  país. Uma subdivisão conhecida contraditória prevalece sobre nomes.
- Confere também o nome da cidade. Considera nomes locais/alternativos e
  formas municipais; não escolhe outra cidade apenas por estar no mesmo estado.
- Após resultado vazio/incompatível, tenta cidade/país e, quando o LocationIQ
  é o primário, o Nominatim público como alternativa. O estado continua sendo
  conferido na resposta; retirar seu nome da escrita não retira esse filtro.
- Até três consultas; 10 s por requisição e 30 s de orçamento total. Não muda
  de serviço nem repete consultas automaticamente em erros de rede, cota ou
  autenticação. HTTP 404 do LocationIQ é tratado como localidade não encontrada;
  HTTP 404 do Nominatim continua sendo erro de serviço.
- Não solicita filtros de tipo que excluam vilas/municípios presentes no
  catálogo. Os resultados ainda precisam identificar a localidade selecionada.
- Mantém o objeto e a geometria completos do resultado escolhido. A descoberta
  comercial conserva seus filtros, limites e classificação. Não cria raios nem
  simplifica polígonos para fazer uma pesquisa passar.
- Invalida caches anteriores de localidade/descoberta. Históricos já salvos
  continuam sendo históricos; uma nova busca aplica a nova geocodificação.
- O diagnóstico autenticado registra provedor, consultas, candidatos e motivos
  de descarte também quando a busca falha. Não registra URLs com chaves.

## Arquivos e validação

Runtime: `server.cjs` e o novo `geocoding.cjs`. Não requer variável adicional,
dependência nova, alteração de banco ou mudança no agente/classificação.

Regressões: `test/discovery.test.cjs`, `test/geocoding.test.cjs` e
`test/fixtures/geocoding-world.json`. Os registros do último arquivo foram
capturados em consultas reais, com geometria omitida apenas no arquivo de
fixture; reexecutá-los é teste de implementação, não de disponibilidade externa.
Dados de localidade: [OpenStreetMap, ODbL](https://www.openstreetmap.org/copyright)
e [Countries States Cities Database, ODbL](https://github.com/dr5hn/countries-states-cities-database).

As regressões locais verificam recuperação, limites, rejeição de país/estado/
cidade incorretos, códigos em níveis diferentes, cache, diagnóstico sem chave,
autenticação e preservação dos demais comportamentos. O teste de navegador
exercita a cascata de seleção com o catálogo local real e intercepta pesquisas
comerciais com fixtures; não é prova de descoberta comercial em produção.

Depois do deploy, refazer uma cidade que falhou. Se persistir, o diagnóstico
da mesma conta revela se houve resposta vazia, cidade/subdivisão incompatível,
falha de serviço ou limite de consultas. Não prometer reconhecimento universal
nem disponibilidade contínua de fontes públicas.
