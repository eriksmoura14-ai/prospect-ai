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
