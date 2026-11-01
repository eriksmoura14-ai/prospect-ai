# Cobertura mundial — retomada em 1º de novembro de 2026

Snapshot SQL: 2026-11-01T20:19:11.951293+00:00. O período gratuito de novembro foi confirmado antes da retomada; o bloqueio de outubro deixou de impedir consultas. Nenhuma quota foi elevada.

O acervo passou de **5.573.373 para 5.693.290 empresas únicas conservadoras**, com **119.917 novas únicas**. A rodada incorporou 120.111 observações e identificou 194 sobreposições. O total é 5.706.232 observações e 12.942 sobreposições. Os 5.680.824 registros canônicos ativos mais 12.466 adicionais do legado formam o total único; as 13.960 observações legadas não são somadas como se fossem únicas. São 50 países/territórios com registros, 39 nos ativos canônicos.

A cobertura mínima permanece incompleta: **12.923 de 152.970 localidades têm pelo menos 50 empresas (8,4481%)**. Outras **140.047** continuam abaixo da meta ou sem confirmação suficiente. O denominador inclui todos os locais do aplicativo.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Pelo menos 50 | 12.750 | 12.923 |
| Pelo menos 100 | 6.774 | 6.873 (4,4930%) |
| Pelo menos 200 | 3.207 | 3.241 (2,1187%) |
| Com registros geograficamente associados | 62.224 | 62.932 |
| Localização pendente | 82.162 | 81.165 |
| Coleta parcial | 58.056 | 58.880 |
| Falha temporária | 2 | 2 |

173 localidades adicionais atingiram 50. As três exceções francesas anteriormente auditadas abaixo da meta continuam preservadas. Somar contagens de cidade e município que se sobrepõem não equivale a contar empresas globais.

## Países trabalhados

| País | Novas únicas | Locais do app | ≥50 | ≥100 | ≥200 | Localização pendente |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Albânia | 4.393 | 143 | 12 | 5 | 1 | 77 |
| Bósnia e Herzegovina | 6.714 | 232 | 19 | 10 | 5 | 202 |
| Bulgária | 19.244 | 504 | 74 | 50 | 20 | 153 |
| Gana | 1.259 | 121 | 0 | 0 | 0 | 121 |
| Grécia | 64.313 | 1103 | 5 | 3 | 0 | 1093 |
| Montenegro | 1.942 | 40 | 6 | 1 | 1 | 23 |
| Macedônia do Norte | 4.786 | 194 | 14 | 8 | 1 | 68 |
| Nigéria | 3.449 | 491 | 1 | 0 | 0 | 431 |
| Sérvia | 13.817 | 379 | 42 | 22 | 6 | 42 |

Os totais por país distinguem canônicos ativos e observações legadas em `country-source-counts.json` no pacote público. As contagens por cidade e por fonte estão no inventário completo; cada local conserva sua próxima ação. Empresas válidas além das metas foram mantidas.

## Causas encontradas e correções

Na Sérvia, a fonte publica `RS-VO` ou região vazia, enquanto o aplicativo usa distritos. O cruzamento revisado exige o descritor administrativo publicado, nível correto, fonte licenciada e ancestralidade consistente. Aumentou o vínculo de 0 para **337 das 379 opções**, preservando Belgrado como unidade distinta. O `local_type=municipality` incorreto não é usado para decidir o distrito.

Na Bulgária, foram aplicadas as regras oficiais de transliteração de 2009 apenas aos nomes búlgaros publicados. As opções explicitamente `Obshtina` usam o município, com nível e nome confirmados, sem estender o polígono de uma cidade comum. O vínculo passou de 124 para **351 das 504 opções**. Cidade e município podem contar um estabelecimento contido em ambos, mas a identidade global continua única.

A recuperação costeira revisitou candidatos já coletados e acrescentou **1.455 únicas**, conciliadas contra os ativos anteriores e o legado. Não usou buffer, raio, cidade vizinha ou Nominatim em massa. Ravda passou de 16 para 78; Tivat de 10 para 74; Herceg Novi de 46 para 89. A derivação preserva ODbL e as licenças originais por registro.

Gana e Nigéria mostram uma limitação distinta: os arquivos comerciais contêm empresas válidas, mas os polígonos de localidades disponíveis não confirmam a maioria das opções do seletor. Gana tem 27 polígonos candidatos e nenhum vínculo aceito; Nigéria tem 2.870 candidatos e 60 vínculos aceitos. Na Grécia, os extratos trazem 182 polígonos candidatos de localidades, e apenas 10 opções do aplicativo satisfizeram todos os critérios. Nome, estado e ponto dentro do polígono continuam obrigatórios. Esses casos permanecem pendentes; não se declara ausência de empresas.

Para 58.880 escopos com coleta parcial e para as localizações pendentes, a próxima ação é complementar fontes permitidas ou revisar limites, respectivamente. As duas falhas temporárias e as auditorias abaixo de 50 permanecem identificáveis no CSV. Nenhuma fonte é declarada mundialmente esgotada.

## Uso real no Prospect

Os três testes consultaram os 24 segmentos na instância de teste existente. O SHA-256 do conjunto de IDs da API foi igual ao testemunho local feito com o leitor real de Parquet.

| Localidade | União de empresas | Descoberta normal | Fluxo normal completo | Cards |
| --- | ---: | ---: | ---: | ---: |
| Gornji Milanovac (RS) | 57 | 4.177 s | 18.977 s | 10 |
| Ravda (BG) | 78 | 3.774 s | 6.732 s | 10 |
| Tivat (ME) | 74 | 3.253 s | 6.604 s | 10 |

Os fluxos terminaram com `archive:true` e usaram os ativos novos do país. As medições incluem a verificação de websites no fluxo normal; não prometem latência universal. Telefones, WhatsApp, atividade atual e websites não são declarados verificados pela coleta. Foram encontrados 101.217 telefones publicados, 35.950 websites e 110.575 endereços entre as 119.917 novas únicas, todas com coordenadas válidas. Nenhum contato foi inventado.

## Preservação, tempo e capacidade

O milhão original conserva 137.403.018 bytes e SHA-256 `f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`. As 152.970 localidades, 20.954 áreas nativas, 50.824 tarefas e os IDs anteriores foram preservados. Os fingerprints de todos os 223 países foram conferidos contra o banco. A verificação das 119.917 linhas novas encontrou 119.917 IDs distintos e zero conflitos de país.

A manutenção de cinco índices com `REINDEX INDEX CONCURRENTLY` recuperou **18.300.928 bytes**, com igualdade dos fingerprints de países e ativos e todos os índices válidos. O banco tinha **211.984.384 bytes** no snapshot final, abaixo do guard de 230.686.720. Não foram apagadas linhas nem usado `VACUUM FULL`.

Foi removido somente um cache DuckDB reconstruível, liberando **683.945.984 bytes locais**. Antes da remoção, todos os Parquets originais e de distribuição tiveram SHA-256 conferido e todas as colunas das 3.129.163 linhas foram comparadas por contagem, soma e XOR de hash. Os arquivos comerciais originais e de distribuição permanecem.

As partições brutas de empresas já existentes foram reutilizadas: **zero bytes novos de download bruto Places**. Houve downloads limitados de geografia, registrados separadamente; não se declara tráfego de rede zero. A normalização de 118.653 observações levou 102,669 s (1.155,71 registros/s). As 15 publicações, em primeira tentativa, levaram 136,464 s agregados (878,74 novas únicas/s). Esses tempos medem etapas; não representam a duração total da tarefa.

Foram publicados 15 arquivos comerciais imutáveis e 176 objetos geográficos, todos com verificação remota integral de SHA-256. As novas empresas e geometrias ocupam **27.738.511 bytes**. Antes do pacote de evidências, o bucket tinha 1.496 objetos e 2.981.688.789 bytes; inclui originais e cópias de distribuição preservadas. Os tamanhos físicos não são contados como empresas.

A reserva acumulada anterior às evidências é 617.379.447 bytes para o período de novembro, incluindo tentativas limitadas e margem para testes; isso é teto conservador comprometido, não consumo faturado medido. A quota continua 5 GB, com 50 MiB reservados ao aplicativo e 32 MiB ao disco local. O contador do provedor pode atrasar. O upload do pacote recebe reserva adicional e recibo separado. Não foram contratados serviços.

Uma consulta HEAD confirmou extratos Geofabrik de Gana (116.793.266 bytes) e Nigéria (713.045.892 bytes). Eles **não foram baixados nem importados**, portanto Geofabrik não conta como fonte efetivamente consultada de empresas nesta rodada. O extrato nigeriano excede o espaço livre local atual; Gana também exige revisão da associação de localidades antes de contar cotas.

## Código, validação e retomada

**107 testes Python passaram**. Os workflows geoespacial/PostGIS e de autenticação passaram no código `7fc07dfd8d898c1f5f9d87d8267ee638e48a784c`. O trabalho está na branch `codex/coverage-audit-policy-20261026` e no [PR 38](https://github.com/eriksmoura14-ai/prospect-ai/pull/38). Main permanece em `7cf5faea13d07b8ca94a39681e5df075721ecd43`, sem merge ou deploy de produção. O serviço de teste usa o código existente `1acc6248bcd181965ebc0cc542767ff854975f20`.

[Pacote público com inventário completo, fingerprints, checkpoints e recibos](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261101/coverage-resume-v1.zip). O hash e o recibo de publicação estão em [evidence/catalog-coverage-resume-20261101.json](evidence/catalog-coverage-resume-20261101.json). O pacote contém apenas uma lista explícita de arquivos públicos; credenciais e URLs assinadas ficam fora.

No workspace preservado, estes comandos retomam de forma idempotente as publicações desta rodada, usando os checkpoints existentes:

```bash
.artifacts/venv-catalog/bin/python .artifacts/coverage-resume-20261101/publish-balkans.py
.artifacts/venv-catalog/bin/python .artifacts/coverage-resume-20261101/publish-coastal.py
.artifacts/venv-catalog/bin/python .artifacts/coverage-resume-20261101/publish-west-africa.py
```

Eles não iniciam uma nova varredura mundial: as 15 publicações desta rodada já terminaram. Uma etapa incompleta só pode voltar a transferir dados após renovar o snapshot de capacidade e as URLs assinadas privadas pela integração conectada, conforme o [runbook](CITY_COVERAGE_RUNBOOK.md). As raízes mais recentes de cada país estão em `progress.json/latestCountryRoots`; os helpers usados estão no pacote, sem seletores privados.

Para continuar a fila abaixo de 50, sem recriar o inventário:

```bash
.artifacts/venv-catalog/bin/python scripts/catalog-ops.py queue --root .artifacts/coverage-resume-20261101/final < .env.coverage-operations
.artifacts/venv-catalog/bin/python scripts/catalog-ops.py claim --root .artifacts/coverage-resume-20261101/final < .env.coverage-operations
```

`queue` preserva as tarefas e prioriza o mínimo de 50; `claim` reserva uma tarefa limitada, mas não executa sua coleta sozinho. A execução seguinte precisa de revisão geográfica e de licença, lote regional cacheado ou fonte permitida, checkpoint e nova reserva de recursos. **Não existe coletor mundial continuamente ativo ou continuação agendada após esta tarefa.** O inventário completo, a fila e os arquivos duráveis permitem retomar sem recomeçar.
