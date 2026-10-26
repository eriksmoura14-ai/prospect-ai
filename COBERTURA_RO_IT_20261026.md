# Cobertura Romênia/Itália e auditorias — 26/10/2026

Foram acrescentadas **402.090 empresas únicas**, sem
reescrever os ativos anteriores. O total consolidado passou de 3.752.249 para
**4.154.339**. Há 4.163.481 observações de
fontes e 9.142 sobreposições identificadas. A deduplicação é
conservadora: fonte/ID, nome, posição e contato/endereço compatíveis; não é uma
certificação de identidade universal. Filiais e endereços conflitantes permanecem.

O primeiro milhão continua byte a byte igual, SHA-256
`f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`.
As cópias geográficas de consulta não são contadas como novas empresas. O
arquivo ativo tem 4.141.873 registros; 12.466 empresas adicionais do catálogo
público anterior completam o total. Há observações comerciais em 28 países.

## Cobertura do inventário inteiro

| Métrica | Total | Percentual de todas as 152.970 localidades |
|---|---:|---:|
| Pelo menos 50 | 9.579 | 6.262% |
| Pelo menos 100 | 5.276 | 3.449% |
| Pelo menos 200 | 2.652 | 1.7337% |
| Algum registro confirmado | 46.213 | — |
| Abaixo de 50 ou sem confirmação | 143.391 | — |
| Exceções auditadas abaixo de 50 | 3 | Não entram em min50 |

A meta mundial continua incompleta. A contagem não usa somente as cidades
processadas como denominador. Permanecem 100.407 localidades
com identidade geográfica pendente, 42.982 com coleta parcial e duas
falhas temporárias. Não se completam cotas com vizinhos, entidades públicas,
pontos de mapa ou empresas inventadas.

## Lotes regionais publicados

| País | Novas empresas únicas | Observações novas | Localidades confirmadas / inventário do país | ≥50 / ≥100 / ≥200 |
|---|---:|---:|---:|---:|
| Romênia | 28.290 | 28.328 | 2.973 / 7.949 | 84 / 43 / 29 |
| Itália | 373.800 | 374.435 | 7.378 / 9.852 | 1.350 / 619 / 258 |

A diferença entre observações e empresas inclui sobreposições com dados antigos.
Os 138 registros italianos anteriores, por exemplo, representam 137 empresas e
continuam preservados. As contagens locais são calculadas em cada polígono
confirmado; não se distribuem registros arbitrariamente por nome de cidade.

Os lotes Overture fixados em 2026-10-21.0 são reutilizados por país: regiões
00009/00010 para RO e 00008/00009 para IT. Só 00008 foi baixada nesta rodada:
721.833.497 bytes em 20,984 s, com duas conexões e checkpoint. As demais já
estavam no cache. Não houve geocodificação sistemática pelo Nominatim.

As novas empresas ocupam 51.955.104 bytes em dois arquivos Parquet imutáveis;
149 arquivos de limites ocupam 31.351.104 bytes, todos com hash remoto conferido.
A conciliação levou 27,773 s na Itália. Ela não inclui download, normalização,
publicação e validação. A velocidade não representa uma promessa de varredura
mundial contínua. O banco operacional mediu 227.631.104 bytes, abaixo
do limite interno de 220 MiB. Conferir espaço novamente antes de outro lote.
A franquia Free do projeto é finita; nenhum plano pago foi habilitado.

Qualidade dos novos registros, sem alegar verificação dos contatos:

| País | Telefone publicado | URL publicada (pode ser perfil social) | Endereço | Coordenadas válidas |
|---|---:|---:|---:|---:|
| RO | 24.694 | 12.936 | 27.071 | 28.290 |
| IT | 347.352 | 165.687 | 369.524 | 373.800 |

As licenças e hierarquias estão em [CATALOG_ATTRIBUTIONS.md](CATALOG_ATTRIBUTIONS.md)
e [CITY_COVERAGE_RUNBOOK.md](CITY_COVERAGE_RUNBOOK.md). A Romênia usa municípios
ANCPI/condados World Bank; vilas sem correspondência não herdam a comuna toda.
A Itália usa províncias ADM3 e comuni ADM4 ISTAT 2023; o nível ADM1 não representa
a subdivisão do aplicativo. Nomes, estado e âncora precisam concordar.

## Complementação OSM e revisão de casos insuficientes

O código rejeitava QLever sempre que a cidade tinha um limite oficial externo
ao OSM, mesmo havendo uma consulta espacial disponível. A correção usa um
marcador neutro `urn:prospect:area`, consulta o retângulo e filtra pelo polígono
inteiro. Não inventa relação OSM nem amplia área para atingir a cota. Limites de
45 s, 500 candidatos, seis MiB e 2° × 3° permanecem. Em consulta real de Trévoux,
o QLever respondeu com oito candidatos de restaurantes em 6,383 s e IDs OSM
originais. Isso não significa oito empresas novas: ainda há deduplicação e
filtragem pelos adaptadores. A correção fica na branch e no staging para teste;
o código principal de produção permanece preservado nesta rodada.

A política autorizada registra Beaumont-en-Verdunois, Bezonvaux e
Fleury-devant-Douaumont como `audited_below_target`: população oficial zero,
catálogo sem empresas elegíveis e cadastro empresarial oficial com 2/1/7
unidades legais ativas. Unidades legais não equivalem a estabelecimentos
comerciais. A falha adicional Overpass 429 em Bezonvaux é falha, não zero. Nenhum
desses casos é declarado universalmente sem empresas ou com todas as fontes
esgotadas. Continuam no denominador e não contam como cinquenta.

A revisão vence em sete dias se houve fonte complementar com falha, senão 30.
Novos dados, contagem ou limite geográfico a invalidam; a fila pode reabrir a
tarefa. O histórico das revisões fica preservado por hash. Há oito cenários
PostgreSQL de validade/expiração e testes de identidade, orçamento, polígonos
com buracos, homônimos e origem dos dados.

## Verificação real e retomada

Caracal (RO/OT/90572): o backend de staging retornou 50 empresas únicas nos 24
segmentos, 44 com telefone, 18 com URL e 50 com endereço. A busca normal descobriu
21 restaurantes e retornou dez em 18,031 s, usando `archive:true`. A conferência
dos segmentos levou 102,873 s. Não foram usadas contas privadas de clientes.

Raffadali (IT/AG/59266): 50 empresas únicas, 48 com telefone, 15 com URL e 48 com
endereço. A busca normal descobriu 27 restaurantes e retornou dez em 11,229 s,
também com `archive:true`. A conferência dos segmentos levou 131,995 s. Os dois
testes percorreram o backend existente e os arquivos duráveis publicados.

A regressão local passou: 319 testes Node e 39 testes Python. Três testes Node
dependentes de PostgreSQL foram pulados localmente; o CI executa esses casos
com PostGIS. Os oito cenários da política de revisão também foram executados
como consultas somente leitura no PostgreSQL real do catálogo público.

Comandos exatos a partir da raiz do projeto, com os arquivos privados já
configurados apenas no ambiente operacional:

```sh
cat .env.coverage-operations | .artifacts/venv-catalog/bin/python scripts/catalog-coverage-audit.py --root .artifacts/catalog-audit-ro-it-20261026
cat .env.coverage-operations | .artifacts/venv-catalog/bin/python scripts/catalog-ops.py queue --root .artifacts/coverage-20261023
cat .env.catalog-smoke | .artifacts/venv-catalog/bin/python scripts/catalog-smoke.py --root .artifacts/city-coverage-romania-20261026 --country RO --state OT --city-id 90572 --niches .artifacts/coverage-20261023/niches.json --expected-unique 50 --normal-search
cat .env.catalog-smoke | .artifacts/venv-catalog/bin/python scripts/catalog-smoke.py --root .artifacts/city-coverage-italy-20261026 --country IT --state AG --city-id 59266 --niches .artifacts/coverage-20261023/niches.json --expected-unique 50 --normal-search
```

A retomada não repete downloads concluídos. `catalog-download.py`, a publicação
de geometrias e as tarefas têm checkpoints. A fila persistida não é um processo
rodando: não há coletor mundial autônomo configurado. Restam os cruzamentos dos
países ainda pendentes e a complementação das cidades abaixo de 50, com revisão
de fontes, licenças e recursos antes de cada lote. O arquivo completo de todas
as localidades, contagens e motivos acompanha a publicação de evidências.
