# Portugal e controle de capacidade — 27/10/2026

Snapshot conferido em **27/10/2026 às 19:09 BRT** (22:09 UTC), com prova SQL e
fingerprints de todos os 223 países do inventário. O código continua na branch
do [PR 38](https://github.com/eriksmoura14-ai/prospect-ai/pull/38), sem merge ou
deploy de produção. Os novos arquivos estão publicados no catálogo persistente.

| Métrica | Antes desta rodada | Depois |
| --- | ---: | ---: |
| Empresas únicas conservadoras | 5.517.669 | **5.573.373** |
| Observações das fontes | 5.530.174 | 5.586.121 |
| Sobreposições identificadas | 12.505 | 12.748 |
| Localidades com pelo menos 50 empresas | 12.639 | **12.750** |

Foram acrescentadas **55.704 empresas únicas**, a partir de 55.947 observações
novas, identificando 243 sobreposições. São 5.560.907 registros canônicos nos
arquivos ativos mais 12.466 empresas adicionais do legado. O catálogo contém
42 países/territórios; Portugal já aparecia no legado, portanto não conta como
um país novo. Os arquivos canônicos agora abrangem 30 países.

O milhão original mantém 137.403.018 bytes e SHA-256
`f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`,
novamente verificado nesta rodada. As 13.960 observações do legado continuam
preservadas, incluindo 401 de Portugal. Observações legadas não devem ser
somadas à coluna de canônicos como se fossem empresas adicionais únicas.

## Cobertura de todo o aplicativo

O denominador continua sendo **152.970 localidades**, incluindo as não
processadas e as três exceções francesas auditadas abaixo da meta.

- Pelo menos 50: **12.750 — 8,3350%**.
- Pelo menos 100: **6.774 — 4,4283%**.
- Pelo menos 200: **3.207 — 2,0965%**.
- Com empresas associadas e confirmadas: 62.224.
- Localização pendente: 82.162; coleta parcial: 58.056; falha temporária: 2.

**Restam 140.220 localidades abaixo de 50 ou sem confirmação suficiente.** Não
há alegação de cobertura mundial concluída ou de coletor continuamente ativo.

## Resultado em Portugal

As duas partições Places já existentes foram reutilizadas, com SHA-256
conferido. Nenhum novo arquivo bruto de empresas foi baixado. Foram
normalizados 55.128 registros antes da deduplicação em 50,777 segundos,
aproximadamente 1.086 registros/s. A extração de limites administrativos foi
limitada ao país e à release fixada, sem baixar o planeta ou usar Nominatim em
massa. Nomes, país, estado e âncora precisaram concordar com o polígono.

Dos 1.296 locais portugueses no aplicativo, 581 tiveram escopo geográfico
confirmado e 485 tiveram empresas efetivamente associadas. Há **111 locais
com pelo menos 50**, 55 com pelo menos 100 e 21 com pelo menos 200. Permanecem
715 localizações não confirmadas e 470 escopos confirmados abaixo de 50,
incluindo 96 sem registro nas fontes consultadas. Isso não prova ausência de
empresas nesses locais. As fontes não são declaradas esgotadas.

| Qualidade dos 55.704 registros únicos novos | Quantidade |
| --- | ---: |
| Telefone público informado | 51.118 |
| Website informado | 18.461 |
| Endereço informado | 54.304 |
| Coordenadas válidas | 55.704 |

Os 24 segmentos foram considerados; os registros novos têm 11 classificações
primárias suportadas, com predominância de restaurantes e cafeterias na fonte.
As contagens por segmento acompanham o pacote. Telefone não confirma WhatsApp;
website ausente na fonte não confirma ausência de website.

A recuperação costeira reutilizou os candidatos já analisados. Exigiu país
publicado concordante e contenção exata em um escopo local confirmado, sem
buffer, raio ou empresa da cidade vizinha. Foram acrescentadas **819 únicas**
após conciliação contra o ativo português e o legado. Os 21 arquivos geográficos
anteriores foram reutilizados com seus hashes; não foram reenviados no delta.
Dados derivados e prova geográfica mantêm ODbL, junto às licenças originais.

| Localidade | Antes da recuperação costeira | Depois |
| --- | ---: | ---: |
| Sagres | 23 | 62 |
| Vila Nova de Cacela | 41 | 55 |
| Moscavide e Portela | 43 | 103 |
| Câmara de Lobos | 49 | 52 |

## Teste real do Prospect

Câmara de Lobos, Madeira, foi consultada no serviço de teste existente. Os 24
segmentos retornaram uma união de **52 IDs**, exatamente igual ao testemunho
local produzido pelo leitor real do aplicativo. SHA-256 do conjunto de IDs:
`95265f5d7c3767cb8006415ca42826146d5d3fb7a2cecd2ba5da3c86794357a3`.

A pesquisa normal retornou dez cards, usando os dois novos ativos persistentes:
descoberta em 4,603 s e fluxo completo em **7,839 s**, incluindo verificação de
websites. O teste sequencial de todos os segmentos levou 102,501 s antes do
fluxo normal. Dos 52 registros, 44 têm telefone, 13 website e 51 endereço.
Esses tempos são medições dessa consulta, sem promessa de latência universal.

## Capacidade e preservação

Uma manutenção comum `VACUUM (ANALYZE)` preservou registros vivos, IDs, índices
e geometrias. As estatísticas de versões mortas passaram de aproximadamente
9.457 para 21, permitindo reutilizar páginas. Não foi usado `VACUUM FULL` nem
apagado ou reconstruído o catálogo. O tamanho físico não foi declarado reduzido.

Entre a conferência anterior e este snapshot, o banco passou de 229.556.224
para **229.572.608 bytes**, crescimento de 16.384 bytes, abaixo do guard de
230.686.720 bytes. Os arquivos comerciais novos somam 6.224.057 bytes; os
7.428.111 bytes de geografia decodificada ocupam 2.331.593 bytes nos objetos
comprimidos. Antes do pacote desta rodada, o bucket tinha **1.304 objetos e
2.950.435.602 bytes**, incluindo originais preservados e cópias de distribuição.

O publicador agora exige uma conferência de capacidade vinculada ao hash do
plano. Rejeita conferência antiga ou de outro país/ativo antes da primeira
requisição; calcula upload e verificação dos arquivos pendentes; mantém
**50 MiB para o aplicativo**, 32 MiB no disco e o guard existente do banco.
Transferências conhecidas ainda não refletidas pelo provedor são reservadas
explicitamente antes de outro lote. A publicação portuguesa teve estimativa
conservadora de 29.194.668 bytes, e o delta de 2.303.972 bytes, com as geometrias
já verificadas reutilizadas. A estimativa inclui transferências e margem de
controle; não é uma medição de tráfego HTTP comprimido efetivamente faturável.

A inspeção do provedor continuou informando 4.885.295.531 de 5.000.000.000 bytes
de transferência; o contador pode atrasar. Não foram aumentadas cotas,
contratados serviços ou habilitadas cobranças. Outra publicação precisa de
nova conferência e de contabilizar também testes, pacote e transferências que
ainda não estejam no contador; a franquia restante não é tratada como ilimitada.

## Evidências e retomada

[Baixar inventário completo atualizado e provas desta rodada](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261027/coverage-portugal-v3.zip).
O pacote contém as 152.970 localidades em NDJSON comprimido, fingerprints SQL,
contagens por país, checkpoints, licenças, hashes e teste real. Os Parquets
comerciais permanecem nos objetos originais referenciados, sem nova cópia no ZIP.
O [pacote anterior](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261027/coverage-accelerated-v2.zip)
conserva o CSV completo anterior; o snapshot novo foi conferido para todos os
223 países, não apenas para Portugal. Datas individuais alteradas não foram
reexportadas e ficam nulas no espelho incremental, conforme a política anterior.

As publicações estão concluídas. Para verificar ou retomar o mesmo lote sem
repetir etapas concluídas, no workspace preservado:

```bash
.artifacts/venv-catalog/bin/python scripts/catalog-publish-country.py --root .artifacts/city-coverage-portugal-20261027 --database-config .env.coverage-operations --asset-config .env.pt-asset-upload --geometry-config .env.pt-geometry-upload --capacity-config .artifacts/coverage-capacity-20261027/usage-PT.json
.artifacts/venv-catalog/bin/python scripts/catalog-publish-country.py --root .artifacts/coastal-pt-20261027 --database-config .env.coverage-operations --asset-config .env.pt-coastal-asset-upload --geometry-config .env.pt-coastal-geometry-upload --capacity-config .artifacts/coverage-capacity-20261027/usage-PT-coastal.json
```

Seletores privados não estão no Git ou no pacote. Caso uma etapa incompleta
precise de novas transferências, renovar a conferência de cotas e, se necessário,
as URLs assinadas. Não reutilizar uma conferência expirada para iniciar outro
país. O [runbook](CITY_COVERAGE_RUNBOOK.md) descreve a fila persistente, limites,
publicação e continuação com revisão geográfica do próximo lote. A fila existe;
nenhum processo continuará executando depois desta tarefa.

**100 testes Python passaram**, incluindo interrupção antes de upload quando
não há orçamento, snapshot antigo, preservação de checkpoints e identidades.
CI de autenticação e geoespacial/PostGIS passou no código `07c4580`.
Interface, login, histórico, exportações, WhatsApp e main foram preservados.
