# Prospect AI 0.7 — busca integrada do Prospect Clientes

O projeto principal mantém contas, listas, histórico, geocodificação internacional,
verificação de sites e agente Groq. A descoberta de empresas ganha o provedor
gratuito OpenStreetMap / QLever, sem chave de API.

## Configuração

O padrão passa a ser `BUSINESS_PROVIDER=qlever`. Uma configuração explícita
`geoapify` ou `overpass` continua funcionando; ela não é sobrescrita pelo código.
Para ativar o QLever em um serviço já configurado, altere somente
`BUSINESS_PROVIDER` para `qlever` no backend Render e publique esta revisão.
Não mova chaves, banco ou sessões para o frontend Vercel.

A mesma relação selecionada e validada pelo geocodificador é consultada pelo
QLever, inclusive relações `place=city` sem `boundary=administrative`. A consulta
fixa a identidade OSM dentro do bloco de descoberta para evitar um join espacial
mundial antes de aplicar a cidade. Não usa raio, outra cidade ou apenas centro urbano.
Localidades representadas por nós ou ways consultam o mesmo retângulo integral
do geocodificador via GeoSPARQL no QLever, sem retornar ao Overpass indisponível.
O retângulo pode incluir áreas vizinhas e continua identificado como retângulo,
não como limite municipal. Localidade ausente no snapshot, erro de rede ou HTTP 429 são falhas
explícitas, sem troca automática de provedor para contornar erro ou cota.

Os 24 nichos existentes são mantidos. Categorias, culinária e nomes passam
pela classificação original; `barbearia` também é reconhecido no nicho Barber.
Tags de telefone, celular, WhatsApp, endereço e site são preservadas como
publicadas. Coordenadas são lidas apenas de geometria POINT; empresas com
geometria não pontual continuam com link para o objeto OSM, sem ponto inventado.
Todos os resultados selecionados continuam passando pelo verificador existente.
A falta de site cadastrado não prova ausência de site próprio.

## Limites

- Fonte: snapshot público mundial do OSM, com cobertura e atualização próprias.
- Até 500 candidatos por consulta, antes dos filtros locais. O 501º registro
  detecta truncamento; a interface e a pesquisa salva informam a amostra parcial.
- Descoberta por categoria e leitura de detalhes em consultas delimitadas.
  A consulta de detalhes só lê os objetos OSM da descoberta. Se a categoria não
  retornar candidatos, consulta nomes no mesmo limite administrativo, sem mudar
  de provedor. São no máximo três consultas, compartilhando o prazo total.
- Limite total de 45 segundos e 6 MiB por resposta. Sem retries automáticos.
- Sem paginação ou promessa de exaustividade. O limite escolhido na interface
  é a quantidade máxima selecionada para verificação.
- A chave Groq ainda é necessária para usar a IA existente.

Referências oficiais: https://qlever.dev/osm-planet,
https://docs.qlever.dev/geosparql/,
https://github.com/ad-freiburg/osm2rdf e https://www.openstreetmap.org/copyright.

## Verificação de publicação

`DISCOVERY_CHECK_RUN` pode receber um identificador novo de 8 a 80 caracteres
(letras ASCII, números e hífen). No backend hospedado com contas habilitadas,
executa uma rodada delimitada de descoberta em Araguari/BR, Sydney/AU e Mumbai/IN,
com a mesma validação de país/estado/cidade da interface. Não envia e-mails, não
cria contas e não verifica sites. Registra apenas contagens, códigos, tempos e
escopo em `DISCOVERY_CHECK`; para imediatamente em erro de autenticação ou cota.
O banco impede repetir a rodada com o mesmo identificador durante 24 horas.
Deixe a variável vazia para desabilitar após validar o deploy.

Erros das buscas normais registram `BUSINESS_DISCOVERY_ERROR` sem telefones,
e-mails, credenciais ou texto das consultas. O health check continua independente
da disponibilidade temporária dos provedores públicos.

Em 20/10/2026, consultas reais ao QLever retornaram candidatos em Araguari,
New York City, Paris, Sydney, Mumbai, Glasgow e Tokyo, em sete países. Usaram
identidades e áreas de respostas reais do Nominatim já registradas nas fixtures;
não representam uma nova validação ao vivo dos geocodificadores. Descoberta e
detalhes levaram entre 1,5 e 9,3 segundos nessa rodada local. New York City,
Paris, Glasgow e Tokyo alcançaram a amostra de 500 e foram marcadas como parciais.
São medições pontuais, sem garantia de disponibilidade. A comparação de duas
consultas equivalentes em Araguari preservou os 11 candidatos e passou de
21,1 segundos para 0,7 segundo; cache e carga da fonte podem afetar a comparação.

## Verificação

`npm test` cobre transporte RDF, fronteiras, limites, erros, contatos, classificação,
cache e regressões dos outros provedores. `npm run build:frontend` verifica a
publicação estática. Testes locais usam fixtures; a disponibilidade real em cada
país e a configuração do serviço publicado precisam de verificação própria.

Em 12 de outubro de 2026, a suíte executou 245 testes com sucesso, sem falhas;
um teste de integração PostgreSQL foi omitido por falta de banco descartável.
O build estático e a checagem sintática passaram. Contas e agente não foram
alterados por esta integração.

Consultas públicas reais, executadas localmente pelo código integrado, sem
chaves de produção:

| Cidade / nicho | Candidatos / classificados | Verificação |
| --- | --- | --- |
| Uberlândia, Brasil / Barber | 31 candidatos; 13 classificados | Geocodificação real; 3 selecionados passaram pelo verificador e permaneceram incertos, sem site confirmado |
| Saskatoon, Canadá / Barber | 5 classificados | Geocodificação e descoberta reais; sem execução do agente ou verificador neste teste |

A consulta QLever de Uberlândia, incluindo detalhes, levou aproximadamente
6,4 segundos em uma execução. O fluxo de geocodificação e descoberta de
Saskatoon levou aproximadamente 45 segundos. São medições pontuais deste
ambiente, sem garantia de tempo de resposta ou de disponibilidade no Render.
