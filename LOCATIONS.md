# Filtros de localização

A interface seleciona país → estado/província → cidade. Alterar país ou estado limpa as escolhas dependentes; respostas antigas de carregamento são descartadas. A lista de países aparece em português e os nomes de estados/cidades preservam os dados de origem.

As listas são servidas pelo próprio backend autenticado, sem chamadas externas ao trocar filtros:

- `GET /api/locations/countries`
- `GET /api/locations/states?country=BR`
- `GET /api/locations/cities?country=BR&state=MG`

`POST /api/search` aceita `location: {countryCode, stateCode, cityId}` além de nicho e quantidade. O servidor valida a relação cidade/estado/país e monta a consulta completa. A busca textual antiga continua compatível com clientes já abertos. Os filtros restringem o país no geocodificador e verificam a subdivisão retornada; não usam as coordenadas do catálogo para mudar a área da descoberta.

O catálogo inclui países e territórios, cidades e outras localidades; não é um cadastro completo de municípios. Para localidades ausentes, escolha “Minha cidade não está na lista” e digite seu nome. Para estados ausentes, escolha a alternativa manual; países sem subdivisões cadastradas oferecem “Sem estado / província”. Esses caminhos mantêm explícitos o país e a subdivisão aplicável. Nenhuma consulta de empresas é limitada a um raio menor por causa das listas.

## Dados e licença

Fonte: [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database), distribuída por `@countrystatecity/countries@1.0.9`, fixada em `package-lock.json`. Os dados e os subconjuntos de nomes/identificadores retornados nas listas seguem a [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). A atribuição aparece no rodapé. Não há chave nem assinatura de API para essas listas.

O pacote é carregado por país/estado no backend. Não enviamos a base mundial inteira ao navegador. Para instalar: `npm ci --ignore-scripts`; para verificar: `npm test`. No Render, o build precisa instalar as dependências antes de iniciar o servidor; o serviço principal já usa `npm install`.

Os testes do geocodificador usam fixtures de regressão, não comprovam disponibilidade da fonte de empresas. A classificação comercial, o agente de IA e a geometria administrativa continuam sendo definidos pelos módulos de descoberta existentes.

## Validação desta versão

Em 2026-10-04: 99 testes Node passaram e 13 cenários Chromium passaram, incluindo Brasil/MG/Uberlândia, EUA/NY/New York City, celular, campos manuais, recuperação de erro e reconexão sem iniciar outra pesquisa. O teste opcional `test/location-browser.py` documenta seus requisitos e usa respostas de jobs apenas como fixtures da interface.

Consultas reais e limitadas ao Nominatim confirmaram os limites administrativos de Uberlândia e Nova York. Também identificaram que repetir cidade/estado homônimos pode produzir estabelecimentos em vez de uma cidade; a consulta agora omite nomes adjacentes repetidos, mantendo as restrições selecionadas. Tokyo continua sujeita à proteção de área já existente: seu limite administrativo inclui ilhas distantes e não é reduzido automaticamente para a região urbana. Esses testes não são uma nova validação de empresas em produção.
