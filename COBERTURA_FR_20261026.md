# Continuação francesa — 26/10/2026

O catálogo foi ampliado com **344.426 empresas únicas adicionais** da França.
O total consolidado passou de 3.407.823 para **3.752.249**, preservando os
arquivos, IDs e registros anteriores. As observações de fontes somam 3.760.718;
8.469 sobreposições foram identificadas pela deduplicação conservadora. Cópias
para consulta não são novas observações.

A meta de cinquenta está confirmada em **8.145 das 152.970 localidades** da
aplicação (5,3246%). Há 4.614 com cem e 2.365 com duzentas ou mais. O denominador
não foi reduzido para os países ou localidades processados. A conclusão mundial
continua pendente; nenhuma localidade recebeu dados de vizinhos para fechar cota.

## Diagnóstico e correção geográfica

A lista francesa tem 10.534 opções. Foram confirmadas 10.148 identidades com o
cadastro oficial INSEE/IGN de 2026; 386 permanecem pendentes. Dessas identidades,
1.346 têm coordenada conflitante no registro da aplicação. Exigir esse ponto
incorreto impedia reconhecer municípios válidos. O adaptador revisado pode usar
nome e departamento **exatos e unívocos** do registro oficial. Mantém o ponto
original e registra a divergência; não escolhe entre homônimos por distância.
Os manifestos públicos enumeram os IDs afetados.

Também há communes associées/déléguées e arrondissements municipais. Esses locais
usam seus próprios contornos oficiais. A relação de códigos antigos com o atual
vem do COG. Um estabelecimento pode atender à opção de distrito e à do município,
sem virar duas empresas globais. Sobreposições sem hierarquia explícita não
recebem associação arbitrária. Opções que representam departamentos inteiros
não foram promovidas a cidades para aumentar cobertura.

Foram reutilizadas as regiões Overture 00006/00007 e processadas 00009/00010,
release 2026-10-21.0, com limites de memória, disco, downloads e duas conexões.
O lote é parcial: Córsega meridional e regiões ultramarinas não foram declaradas
esgotadas. Não houve geocodificação municipal em massa pelo Nominatim.

O país tem 1.070 opções com pelo menos cinquenta, 478 com cem e 207 com duzentas.
Os 9.078 locais com coleta parcial e os 386 sem identidade confirmada continuam
com suas pendências explícitas.

## Qualidade e funcionamento real

Dos 344.426 novos registros: 315.577 têm telefone publicado, 190.247 possuem URL
pública, 341.684 têm endereço e todos têm coordenadas válidas. URL pode ser perfil
social; telefone não confirma WhatsApp. Os dados são coletados, não uma
certificação de funcionamento ou confirmação de ausência de website.

O novo Parquet tem 45.156.071 bytes, SHA-256
`95a5aad8e2544e1f9cce1da4a5a3399c3559532702649ef5ba5f9e9e20296eb9`.
Foi publicado no bucket durável existente. Os 98 blocos de limites, com
16.788.460 bytes, tiveram SHA-256 remoto conferido. A identidade dos arquivos
oficiais usados e a reprodução do cruzamento também foram verificadas.

No staging isolado, Trévoux retornou **51 empresas únicas** nos segmentos atuais,
50 com telefone e 27 com URL. A busca normal descobriu 19 restaurantes e retornou
dez resultados com `archive:true`, em 15,725 s. A conferência dos 24 segmentos
levou 153,544 s. Não foram usadas contas privadas de clientes. Os testes locais
de catálogo têm 24 casos aprovados; o CI também verifica autenticação e PostGIS.
O banco operacional permaneceu abaixo de seu limite de 220 MiB e nenhum plano
pago ou cobrança foi ativado.

## Limite real da exigência de cinquenta em toda opção

A lista inclui comunas sem habitantes. O COG oficial 2026 informa população
zero para Beaumont-en-Verdunois, Bezonvaux e Fleury-devant-Douaumont. A consulta
ao registro empresarial oficial francês retornou, respectivamente, duas, uma
e sete unidades legais ativas. Esses números não equivalem a comércios dos
segmentos do Prospect: em Bezonvaux o único resultado foi **COMMUNE DE BEZONVAUX**,
atividade 84.11Z, administração pública, que não foi importada como empresa-alvo.
Nenhuma empresa dos segmentos atuais foi encontrada nesses três limites no
lote Overture consultado. Um teste adicional no Overpass recebeu HTTP 429;
não houve repetição automática nem interpretação dessa falha como resultado zero.
Isso é ausência de evidência suficiente nas fontes consultadas; não uma afirmação universal sobre todo negócio não registrado.

Consulta reproduzível:
https://recherche-entreprises.api.gouv.fr/search?code_commune=55050&etat_administratif=A&per_page=1

Cadastros e licenças:

- https://unpkg.com/@etalab/decoupage-administratif@6.0.0/data/communes.json
- https://www.data.gouv.fr/api/1/datasets/5808de39c751df1e0679df72/
- https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/communes-100m.geojson.gz
- https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/communes-associees-deleguees-100m.geojson.gz

Portanto, cinquenta empresas **confirmáveis em toda opção**, sem exceções, não é
um encerramento que os dados permitam garantir. A fila e os estados abaixo da
meta foram preservados. Nenhuma exceção foi contada como meta atingida, e a
solicitação de esclarecimento do critério não altera essas contagens.

## Persistência e retomada

Os dados são usados pelo backend existente e estão em armazenamento durável.
Os arquivos anteriores permanecem intactos. Os novos scripts e as instruções
estão em [CITY_COVERAGE_RUNBOOK.md](CITY_COVERAGE_RUNBOOK.md).

```sh
cat .env.coverage-operations | .artifacts/venv-catalog/bin/python scripts/catalog-coverage-audit.py --root .artifacts/catalog-audit-france-20261026
cat .env.catalog-smoke | .artifacts/venv-catalog/bin/python scripts/catalog-smoke.py --root .artifacts/city-coverage-france-20261026 --country FR --state 01 --city-id 47408 --niches .artifacts/coverage-20261023/niches.json --expected-unique 51 --normal-search
```

Não há trabalhador mundial em segundo plano. A fila persistente separa coleta,
identidade pendente, revisão de fontes e resultado insuficiente. A franquia
gratuita continua finita; os dados já coletados são reutilizados antes de novas
consultas. Atribuições e licenças permanecem em
[CATALOG_ATTRIBUTIONS.md](CATALOG_ATTRIBUTIONS.md).
