# Cobertura mínima por cidade

A meta é 50 empresas únicas por localidade enumerável da aplicação, somando os
segmentos atuais. O denominador continua sendo 152.970; volume mundial e
localidades processadas não substituem essa medida. Empresas acima da meta são
preservadas. A coleta não comprova atividade atual, WhatsApp ou ausência de site.

## Rodadas e retomada

`catalog-ops.py queue` cria por padrão apenas novas tarefas abaixo de 50.
`claim` exclui rodadas 2 e 3 por padrão. O operador precisa fornecer explicitamente
`minimumOnly:false` / `allowHigherTargets:true` para trabalhar em 100/200. Tarefas
anteriores permanecem preservadas. Uma fila persistida não é um worker ativo.

Cada país precisa de revisão de licença, hierarquia administrativa, estado e
fonte antes de usar `catalog-country.py`. Não se pressupõe que ADM2 seja uma
cidade em qualquer país. Brasil usa municípios IBGE/OCHA via gbOpen, 2020,
CC BY 3.0 IGO; o cruzamento estadual usa fonte CC BY 2.5, 2006. México usa
municípios World Bank via gbOpen, 2012, CC BY 4.0; estados INEGI, 2020,
CC BY 3.0 IGO. As geometrias mexicanas são a simplificação publicada pela fonte.
Mudanças posteriores ao ano da fonte e localidades sem polígono correspondente
ficam pendentes. País, estado, nome normalizado e âncora dentro do polígono são
exigidos; não se usa a cidade vizinha nem um raio para preencher a cota.

Também foram revisados Colômbia (DANE, municípios 2020, CC BY 4.0) e Guatemala
(CONRED/OCHA, municípios 2021, CC BY 3.0 IGO). Seus cruzamentos estaduais usam
polígonos OSM/Wambacher sob ODbL, com atribuição preservada. O HDX `cod-ab-col`
confirma explicitamente que os 1.122 objetos ADM2 são municípios/distritos,
apesar de o campo canônico do gbOpen dizer `Unknown`. Essa exceção não autoriza
níveis desconhecidos de outros países. Cruzamentos/contagens derivados de OSM
mantêm ODbL e atribuição; os arquivos comerciais Overture independentes mantêm
seus dados, rótulos de cidade e licenças originais, sem redistribuir geometria OSM
como se fosse dado Overture.

Na Guatemala, a lista atual usa códigos estaduais numéricos e a fonte revisada
usa códigos ISO alfabéticos antigos. O vínculo usa o nome estadual exato e
unívoco da lista, além de verificar cada âncora no polígono. Aliases locais
controlados retiram o sufixo `Guatemala` e reconhecem `Guatemala City`/`Ciudad de
Guatemala`; não há aproximação por distância nem busca de nome semelhante.

As fontes gbOpen DEU/ADM3 (428 distritos/cidades independentes) e FRA/ADM3
(320 arrondissements) não foram aceitas como limites municipais gerais.
FRA/ADM4 tem nível canônico desconhecido e apenas 2.054 unidades; sua equivalência
às comunas também não foi assumida. Isso mantém pendências explícitas, em vez
de preencher uma cidade com empresas de todo o distrito.

A fonte estadual mexicana rotulou o Distrito Federal com o mesmo ISO do Estado
de México. O cruzamento revisado usa CMX para esse polígono histórico, confirma
âncoras CMX da lista atual e o ponto central de Ciudad de México, e rejeita outras
colisões. O identificador original e a regra estão preservados no script.

1. Usar os JSON STAC da release fixada `2026-10-21.0`; salvar um
   `source-asset.json` por região. `catalog-download.py --region DIRETORIO` retoma
   blocos já concluídos e verifica SHA-256. Reutilizar arquivos existentes.
2. `catalog-region.py --region DIRETORIO --baseline BASE.parquet --countries
   countries-natural-earth.geojson --niches niches.json --country-code BR`
   escreve saída separada por país e não altera os dados US/CA.
3. `catalog-country.py boundaries --root SAIDA --country BR --inventory
   inventory.json --state-metadata META_ADM1.json --city-metadata META_ADM2.json
   --states ADM1.geojson --cities ADM2.geojson` cria o vínculo de localidades.
4. `catalog-country.py reconcile --root SAIDA --country BR --region
   normalized-BR.parquet --region OUTRA_REGIAO/normalized-BR.parquet --legacy
   legacy-snapshot.json --niches niches.json` combina o catálogo anterior,
   remove sobreposições conservadoras e gera contagens por cidade. A conciliação
   pode ser refeita a partir das etapas normalizadas, sem repetir downloads.
5. Publicar o novo Parquet em chave imutável com hash, usando uma URL assinada
   pela integração Neon e `catalog-upload.py` (JSON pela entrada padrão).
   Registrar com `catalog-ops.py asset` somente após verificar o arquivo remoto.

## Limites geográficos fora do banco pequeno

Os polígonos PostGIS existentes continuam preservados. Para novos países, usar
`catalog-country.py geometry --root SAIDA --country MX`: gera blocos JSON por
estado, de até 2 MiB, com país/estado/cidade e SHA-256. Isso evita encher o banco
gratuito com todas as geometrias mundiais.

Obter URLs assinadas de upload para os `uploads` de `geometry-publication.json`.
Fornecer `root` e `uploads` ao `catalog-geometry-upload.py` por stdin, acrescentando
`signedUrl` e `headers` em cada item. O script usa duas conexões e verifica todos
os hashes remotamente; `geometry-upload-checkpoint.json` permite retomada.
Nenhuma URL assinada ou credencial vai no pacote público.

Aplicar `db/catalog-geometry-access.sql` **somente** no catálogo público isolado.
O papel do aplicativo continua sem escrita e sem acesso a contas de clientes.
Registrar os `manifests` com `catalog-ops.py geometry_manifest`, após os uploads.
Usar `catalog-ops.py coverage` com `externalGeometry:true`; o inventário mantém
as contagens e a indicação `licensed_polygon_archive`, sem duplicar o polígono
no PostGIS. Executar `queue` com `minimumOnly:true` ao terminar.

O backend usa primeiro o polígono PostGIS existente e depois esses blocos
licenciados. Verifica origem permitida, tamanho, SHA-256, identidade e ambiguidade;
cache limitado a 4 MiB de documentos, downloads de até 2 MiB e no máximo dois
simultâneos. Falha preserva os mecanismos interativos existentes e não significa
ausência de empresas. Contatos e dados privados nunca são enviados a esse leitor.

## Recursos e critérios de encerramento

O limite operacional do banco permanece 220 MiB, abaixo da quota gratuita.
Não o aumentar para contornar falta de espaço. Conferir disco, quotas atuais,
índices e transferência antes de novos lotes. Os arquivos comerciais ficam no
bucket público existente; a autenticação continua em outra base.

Todos os registros novos precisam de país e coordenadas válidas, categoria
compatível, proveniência e licença. Sem site/telefone não é motivo de descarte.
Mesmo OSM ID entre QLever/Overpass/Geofabrik é a mesma observação de origem.
Filiais e endereços conflitantes são preservados. Correspondências incertas não
são fundidas apenas pelo nome. As observações sobrepostas e aliases ficam no
pacote de evidências. Os IDs e arquivos anteriores não são reescritos.

Registrar `target_met`, `partial`, `temporary_failure`, `location_pending` ou
`sources_below_target` conforme evidência. Não declarar 50 quando só houver 49.
Não marcar fontes esgotadas quando apenas uma importação regional terminou.
Não instalar varredura mundial contínua, contratar serviços ou ativar cobranças.

## Arquivos de consulta por região (serving v2)

O arquivo original de um milhão e as expansões permanecem imutáveis. O comando
abaixo gera cópias para consulta; essas cópias **não** são novas empresas nem
novas observações de fonte. `input-assets.json` contém os ativos anteriores,
seus caminhos locais, SHA-256 e contagens. Usar todos os arquivos de áreas
municipais já confirmadas em `--areas`, repetível:

```sh
python scripts/catalog-serving.py --input SAIDA/input-assets.json --root SAIDA \
  --areas COBERTURA_USCA/admin-areas.ndjson --areas COBERTURA_BR/admin-areas.ndjson
```

O operador usa DuckDB limitado a 512 MiB e 3 GiB de spill. Só o índice de
coordenadas de um país entra em memória; registros completos ficam no disco.
Os intervalos Morton são disjuntos e não são divididos se um município conhecido
passar do orçamento existente de oito arquivos. Identificadores, rótulos de
cidade, contatos, licenças e datas são preservados. A comparação de todos os
campos usa contagem e agregados inteiros de hashes, além dos hashes SHA-256 dos
arquivos. Uma divergência impede a conclusão do manifesto.

Fornecer `{root,uploads}` por stdin a `catalog-serving-upload.py`, com URLs
assinadas recebidas pela integração. Duas transferências simultâneas, até três
tentativas e `upload-checkpoint.json` permitem retomada. Credenciais e URLs
assinadas nunca entram em Git, relatórios ou pacotes públicos.

`catalog-serving-publish.py stage --root SAIDA` recebe `{url}` por stdin e
registra somente arquivos de staging. Após comprovar o deploy do leitor que
filtra por sobreposição geográfica **antes** de `LIMIT 9`, executar `activate`
com `{url,bboxReaderLive:true}`. A troca é atômica e verifica todos os IDs,
hashes e contagens. Os ativos anteriores passam a `retired`, seus arquivos e
metadados continuam preservados, e o recibo registra a correspondência.
Nunca ativar mais de oito arquivos por cidade em um backend antigo.

O limite de transferência não é ilimitado: a documentação e a conta Free
foram verificadas em 26/10/2026, com 5 GB/mês por projeto compartilhados entre
produtos. Uma configuração anterior de 1 GiB foi ajustada para 5.000.000.000
bytes, dentro dessa franquia, sem alteração de plano. Outras quotas e o limite
operacional de 220 MiB permanecem iguais. Conferir consumo antes de publicar.

## Espanha: municípios e províncias

A lista atual usa províncias. O cruzamento revisado usa INE ADM2 (52 províncias,
2018), com condições de reutilização comercial, atribuição, data e ausência de
endosso em `https://www.ine.es/ss/Satellite?L=0&c=Page&cid=1254735849170&p=1254735849170&pagename=Ayuda/INELayout`.
Não usa comunidades autônomas como se fossem as opções estaduais do aplicativo.
Como essa fonte não publica ISO, apenas nomes exatos e cinco equivalências
documentadas são aceitos. Os municípios IGN/Open Data ESRI de 2018 são ADM3,
8.205 unidades, CC BY 4.0 via gbOpen. O ponto da localidade e o polígono
municipal ainda precisam concordar com a província. Homônimos ou nomes/limites
não confirmados permanecem pendentes. Não presumir que ADM2 seja município.

Reutilizar regiões Overture 00005/00006 já baixadas e a região 00007, release
2026-10-21.0. Não repetir download por município. A normalização e conciliação
continuam usando somente os segmentos efetivamente suportados pelo Prospect.

## França: cadastro oficial e coordenadas incorretas no seletor

`catalog-france.py` usa um único extrato nacional de contornos municipais
IGN ADMIN EXPRESS 2026 generalizado a 100 m pela DINUM/Etalab, junto ao COG 2026
de `@etalab/decoupage-administratif@6.0.0`. Conferir os SHA-256 dos downloads e
a licença `lov2` do produtor oficial no dataset data.gouv `5808de39c751df1e0679df72`.
COM de fontes não revisadas não entra na atribuição do IGN.

Municípios delegados/associados usam seu próprio contorno; não recebem empresas
de todo o novo município. O vínculo pai é explícito no registro COG. Uma empresa
no distrito e no município pode atender às duas opções de localidade, mantendo
uma única identidade global. Sobreposições entre vizinhos sem esse vínculo são
ambíguas e não entram nas contagens.

```sh
python scripts/catalog-france.py --root SAIDA_FR --inventory INVENTARIO/inventory.json --repair-registry-coordinates
python scripts/catalog-country.py reconcile --root SAIDA_FR --country FR --region REGIAO/normalized-FR.parquet --legacy INVENTARIO/legacy-snapshot.json --niches INVENTARIO/niches.json
python scripts/catalog-country.py geometry --root SAIDA_FR --country FR
```

Sem a flag, a âncora deve concordar com o contorno. Com a flag revisada para esta
fonte oficial, nome e departamento exatos que identificam **uma única** unidade
INSEE permitem corrigir a busca mesmo quando a coordenada do seletor está em
outro estado. O valor original não é apagado: o inventário registra
`official_unique_name_department_registry_coordinate_conflict`. Homônimos não
são escolhidos por aproximação. O contorno oficial determina a área consultada.

O inventário do aplicativo inclui departamentos, localidades antigas e comunas
sem habitantes. Isso exige revisão explícita: não assumir que toda opção tem
cinquenta comércios. Registrar fontes, evidência e resultado insuficiente em vez
de completar a cota com organizações públicas, pontos turísticos ou vizinhos.


## Romênia e Itália: hierarquia revisada

Na Romênia, usar os 42 condados ADM1 World Bank (2017) e os municípios ADM2
ANCPI (2016), ambos publicados por gbOpen sob CC BY 4.0. O conjunto original
ANCPI em https://data.gov.ro/dataset/unitati-administrative registra
OGL-ROU-1.0; sua proveniência permanece na atribuição. Vilas de uma comuna não
herdam automaticamente todas as empresas dessa comuna. Nome, estado e âncora
precisam concordar com o polígono municipal.

Na Itália, a equivalência revisada é ADM3 = 107 províncias e ADM4 = 7.901
comuni ISTAT (2023), CC BY 3.0 via gbOpen. ADM1 são macrorregiões e não servem
como as províncias oferecidas pelo aplicativo. A hierarquia oficial está em
https://www.istat.it/it/archivio/222527 . O campo canônico `Unknown` desses
metadados só é aceito no perfil italiano explicitamente revisado. Os aliases
provinciais publicados em `catalog-country.py` ligam nomes italianos aos nomes
da lista, sem aproximação por distância. Frações não confirmadas continuam
pendentes. Reutilizar as regiões Overture 00008/00009 para IT e 00009/00010 para
RO; não repetir downloads por cidade.

## Auditorias documentadas abaixo de 50

Uma localidade com menos de 50 empresas nunca entra em `min50`, nem sai do
denominador completo. A decisão autorizada é registrar casos excepcionais como
`audited_below_target`, separadamente de `target_met`. O operador
`scripts/catalog-review.py --root DIRETORIO` recebe pela entrada padrão
`{url,reviews}`; a credencial é exclusivamente do catálogo público isolado.

Exigir limite confirmado, contagem atual e duas fontes independentes bem
sucedidas: catálogo comercial e cadastro oficial empresarial. Para localidade
sem habitantes, também exigir cadastro oficial de população zero. Unidades
legais não equivalem a estabelecimentos: esse limite permanece explícito e o
perfil sem habitantes não vale para qualquer município pequeno. Uma falha,
HTTP 429 ou catálogo vazio isolado não autoriza uma exceção. As fontes não são
declaradas esgotadas. Revisões anteriores ficam preservadas por hash.

A revisão vence em 30 dias, ou sete se alguma fonte complementar falhou. Novos
dados, mudança da contagem ou da versão geográfica a invalidam. `queue` reabre
essas condições as tarefas encerradas por revisão e `claim` não seleciona uma
exceção ainda válida. Execute `queue` antes de retomar a fila. A auditoria
completa informa `audited_below_target`, `remaining_unaudited` e as datas no CSV;
`percent_min50` continua usando todas as 152.970 localidades. Não há worker
mundial automático configurado.

## Complementação QLever com limite oficial

A busca interativa agora pode consultar OSM/QLever a partir de um polígono
licenciado sem inventar um ID de relação OSM. O identificador `urn:prospect:area`
é apenas um marcador de correlação da consulta. A seleção inicial usa o
retângulo do polígono e o adaptador filtra o resultado pelo polígono inteiro,
incluindo buracos. Os IDs dos estabelecimentos permanecem os originais OSM.
QLever, Overpass e Geofabrik do mesmo objeto não são empresas diferentes.

Permanecem os limites existentes: 45 segundos, seis MiB de resposta, 500
candidatos e retângulo máximo de dois graus de latitude por três de longitude.
Áreas maiores exigem recorte regional revisado; não são trocadas por raio ou
cidade vizinha. Truncamento e indisponibilidade são explícitos. O catálogo
existente é consultado primeiro. Essa correção do código não significa que as
152.970 cidades já foram consultadas ou que todos os resultados OSM sejam novos.

## Limites Overture globais, consulta regional e retomada

O adaptador `catalog-world-boundaries.py` usa a release 2026-10-21.0 do tema
Overture divisions, publicada sob ODbL 1.0, derivada de OpenStreetMap e
geoBoundaries. Conservar a atribuição e as licenças por feição; os contornos e
contagens derivados são ODbL. Os registros comerciais Overture independentes
continuam com suas proveniências e licenças originais.

`catalog-division-read.py` consulta **uma** partição e um país por execução,
filtrando `locality`/`localadmin`, país e `is_territorial=true`. A consulta usa
um gateway local de intervalos; as requisições públicas mantêm proxy e TLS.
Limites: 128 MiB novos por execução, 180 segundos, 512 MiB de DuckDB e no máximo
32 MiB por intervalo. Não baixa todas as partições mundiais. Fragmentos ficam
com URL e SHA-256 para retomada; `--offline` só usa intervalos já verificados.
`--metadata` expõe os grupos físicos, e `--first-row`/`--last-row` permitem
recuperar grupos completos já armazenados sem chamadas externas. A segmentação
física não altera limites geográficos nem autoriza empresas vizinhas.

O cruzamento exige país, ISO 3166-2 correspondente à subdivisão do seletor,
nome primário/comum normalizado exato e âncora dentro do polígono. Ambiguidades,
polígonos fora do orçamento e fontes não revisadas permanecem pendentes.
Não usa condados como se fossem cidades. A auditoria completa anterior é
obrigatória: um país com cruzamento já confirmado exige mesclagem explícita;
o adaptador não pode sobrescrevê-lo com a nova fonte.

```sh
python scripts/catalog-division-read.py --root SAIDA_DIV --assets SAIDA_DIV/assets.json --asset 00003 --country DE
python scripts/catalog-world-boundaries.py --root SAIDA_DE --inventory INVENTARIO/inventory.json --coverage-audit AUDITORIA/all-city-coverage.csv --country DE --region SAIDA_DIV/DE-00002.parquet --region SAIDA_DIV/DE-00003.parquet
```

Os extratos novos usam grupos Parquet de 2.048 registros para limitar a memória
na leitura de polígonos grandes. Se um extrato antigo tiver grupo excessivo,
reparticioná-lo em outro arquivo, verificar todos os campos por agregados de
hashes e conservar o original e seu recibo. Não elevar o limite de memória para
ignorar a falha. Falhas do túnel do ambiente são separadas de erros das fontes;
nenhuma delas equivale a uma cidade vazia.

A fila materializa até 250 novas tarefas por chamada, com até 50.000 ativas e
margem conservadora de 4 KiB por nova tarefa dentro dos 220 MiB operacionais.
As demais cidades continuam no inventário persistente; tarefas existentes não
são apagadas. Repetir `queue` ao consumir a fila, não criar outra cópia de todo o
inventário. Uma recontagem geográfica preserva o Parquet imutável descrito em
`published-asset.json`: mudança em qualquer campo exige publicação separada.

Antes de selecionar extratos de empresas, executar `catalog-source-plan.py
--countries .artifacts/catalog-million-20261023/countries-natural-earth.geojson
--stac .cache/overture/2026-10-21.0-places-stac.json --country NL --country BE
--root SAIDA`. O plano cruza todos os polígonos do país com todas as partições,
incluindo fragmentos separados. Não selecionar apenas o extrato da capital ou
uma faixa de latitude: isso omitia a parte oeste dos Países Baixos e da Bélgica.
O comando não baixa empresas; lista arquivos já disponíveis para reutilização.
Conferir os hashes dos arquivos em cache antes de normalizá-los. Os territórios
continuam sujeitos ao código de país publicado e à revisão de limites; a
interseção do plano não autoriza reclassificá-los. Partições consultadas não
comprovam cobertura completa de empresas.

Durante indisponibilidade da rede do executor, `catalog-division-read.py
--root RAIZ --assets assets.json --asset 00003 --country PL --cached-plan`
inspeciona exclusivamente os intervalos já salvos e verificados. Ele lista
janelas cujas colunas estão em cache. A leitura real com `--offline
--first-row INICIO --last-row FIM` ainda é obrigatória: buffers do leitor
podem precisar de intervalos adicionais. Uma falha informa os bytes ausentes,
não baixa automaticamente e não significa que a região não tenha empresas.
Os arquivos concluídos usam nomes separados por janela e preservam a origem.

Para ampliar um país já publicado, conservar o diretório anterior e fornecer
`--merge-existing DIRETORIO_ANTERIOR` ao `catalog-world-boundaries.py`.
Todos os vínculos anteriores devem reaparecer com a mesma identidade e o mesmo
polígono, ainda atendendo país, estado, nome e coordenadas. Uma fonte nova que
produza outra candidatura não substitui automaticamente esse vínculo. Fonte ou
geometria conflitante interrompe a preparação. Guardar os relatórios anteriores
em histórico e executar novamente a conciliação: o Parquet publicado fica
byte a byte igual quando os registros não mudam.

### Publicação retomável de um país preparado

`catalog-publish-country.py` aceita seletores de arquivos privados, não valores
de credenciais na linha de comando. Executa um único país, com trava local,
limite de 220 MiB no banco e verificação do conteúdo antes da ativação. Exemplo
exato desta rodada, idempotente quando concluído:

```bash
.artifacts/venv-catalog/bin/python scripts/catalog-publish-country.py \
  --root .artifacts/city-coverage-austria-v4-20261026 \
  --database-config .env.coverage-operations \
  --asset-config .env.austria-v4-asset-upload \
  --geometry-config .env.austria-v4-geometry-upload
```

Acrescentar `--check-only` verifica arquivos, país, hashes e os destinos
assinados sem acesso à rede. As URLs de upload, obtidas pelo conector Neon,
expiram: renovar pelo mesmo projeto/bucket/chaves quando houver etapas de
upload pendentes; não publicar esses arquivos privados no Git ou nos pacotes.
O comando reconhece um objeto que já foi enviado e verifica seu SHA-256,
sem sobrescrevê-lo. `publication-checkpoint.json` guarda as etapas terminadas;
falhas de rede deixam o país retomável. Não há repetição automática ilimitada.

Quando só a cobertura geográfica mudou, conservar o ativo comercial e usar
`--geography-only`. O comando exige o ativo congelado e registrado, verifica
seu hash, publica novas geometrias e contagens, e cria um checkpoint separado
por hash. Não reenviar nem registrar novamente as mesmas empresas.

Nos testes reais, executar `catalog-smoke.py` em série: o serviço gratuito
limita o leitor de arquivos a uma consulta simultânea. Contagens certificadas
podem ser menores que os registros dentro de um polígono quando há sobreposição
entre áreas administrativas. Não aumentar a certificação automaticamente:
registrar o motivo e comparar a lista exata de IDs da aplicação com a extração
local usando `--expected-source-sha256`. O teste grava a evidência também
quando uma comparação falha.

Para geometrias novas, `catalog-geometry-upload.py` aceita `gzip:true` no JSON
privado de entrada. Preserva os bytes e SHA-256 do JSON descomprimido no manifesto
e grava o objeto com `Content-Encoding:gzip`. Requests e o fetch Node decodificam
o transporte; a validação continua usando tamanho e hash descomprimidos. Um
objeto real foi verificado pelos dois clientes antes de habilitar essa opção.
Os hashes/geometrias antigos e os limites do leitor permanecem válidos.
