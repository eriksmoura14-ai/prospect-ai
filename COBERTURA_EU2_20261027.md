# Cobertura confirmada e retomada — 27/10/2026

A meta continua sendo **50 empresas únicas por cada uma das 152.970 localidades** do aplicativo, somando os segmentos suportados. Esta rodada não concluiu a meta mundial. O código de produção e o acervo original continuam preservados.

## Publicação confirmada no catálogo público

Snapshot SQL de 2026-10-27T09:40:55.4415+00:00, conferido novamente após a interrupção:

| Métrica | Antes desta expansão | Confirmado após SK/HU/SI/HR |
| --- | ---: | ---: |
| Empresas únicas conservadoras | 4.926.274 | **4.979.881** |
| Observações das fontes | 4.937.165 | 4.990.876 |
| Sobreposições identificadas | 10.891 | 10.995 |
| Localidades com pelo menos 50 | 11.937 | **12.131** |
| Localidades com pelo menos 100 | 6.316 | 6.420 |
| Localidades com pelo menos 200 | 3.006 | 3.045 |

Foram acrescentadas **53.607 empresas únicas**. Há 4.967.415 registros canônicos em arquivos ativos e 12.466 empresas adicionais do catálogo legado. Arquivos de distribuição espacial, objetos preservados e observações repetidas não são contados como empresas novas.

| País | Novas empresas únicas | Observações novas | Localidades do aplicativo | Limites confirmados | Pelo menos 50 / 100 / 200 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Eslováquia | 11.655 | 11.670 | 233 | 221 | 95 / 56 / 22 |
| Hungria | 24.460 | 24.497 | 1.074 | 873 | 68 / 33 / 12 |
| Eslovênia | 4.659 | 4.688 | 312 | 16 | 2 / 1 / 0 |
| Croácia | 12.833 | 12.856 | 663 | 490 | 29 / 14 / 5 |

O denominador mundial é o inventário completo, com localidades em 223 países e territórios; não somente os países processados. **7,9303%** atingem 50 e **140.839 localidades ainda não atingem essa meta ou não têm localização confirmada**. Há 85.274 localizações pendentes, 55.563 coletas parciais e duas falhas temporárias. As três exceções francesas auditadas permanecem abaixo da meta e dentro do denominador.

A auditoria incremental reaproveitou o export completo anterior, aplicou os quatro países e comparou país por país os fingerprints de **todas** as chaves, contagens, segmentos e estados contra o PostgreSQL. Um país ausente, contagem alterada ou cidade trocada faz a verificação falhar. A auditoria não precisou retransmitir todos os 153 mil registros. Prova compacta: [evidence/catalog-coverage-eu2-20261027.json](evidence/catalog-coverage-eu2-20261027.json).

Validações reais anteriores à interrupção: Solin (Croácia), 54 empresas, 45 com telefone e 12 com website; Okres Bánovce nad Bebravou (Eslováquia), 50 empresas, 45 com telefone e 25 com website. Contatos publicados continuam não verificados. Os testes de Hungria e Eslovênia ainda precisam de exemplos de consulta reais nesta rodada.

## Reino Unido: coletado, ainda sem publicação confirmada

Duas partições já existentes foram processadas uma única vez para o país, sem download por cidade. Resultado preparado: **354.577 novas empresas únicas**, 355.131 novas observações e 554 sobreposições novas. Incluindo o legado britânico, a conciliação contém 354.712 empresas únicas e 355.269 observações; esses números combinados não são somados outra vez ao catálogo mundial.

Das novas empresas, 322.772 têm telefone publicado, 237.043 têm website informado, 346.659 têm endereço e todas têm coordenadas válidas. Coleta não comprova atividade atual, WhatsApp nem ausência de website.

O cruzamento confirmou 1.130 limites para 3.879 localidades britânicas. As contagens preparadas são 251 localidades com pelo menos 50, 124 com 100 e 50 com 200. Outras 2.749 continuam com localização pendente e 879 estão abaixo de 50. Foram preservados os 877 cruzamentos da etapa anterior. Os nomes e a âncora devem concordar com o limite e com a hierarquia administrativa publicada, inclusive o identificador do condado. Divergências entre as hierarquias permanecem pendentes. Não se troca uma cidade pelo condado inteiro.

O arquivo comercial já chegou ao armazenamento durável:
[GB Parquet](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/snapshots/20261027/gb-min50-8f72400bf2d95bc2.parquet),
46.973.005 bytes, SHA-256 `8f72400bf2d95bc27eb9d34bbb5ca2f7f3012e742903dcd36f428bcd2b6c5849`.
O tamanho remoto e a leitura pública dos primeiros bytes foram confirmados. A confirmação integral do hash remoto e a publicação dos 106 objetos de geometria não foram recuperadas após a queda. O arquivo **não está registrado como ativo**, não entra nas contagens acima e ainda não é aproveitado pelas pesquisas.

O ambiente do Codex ficou offline durante a publicação. O banco confirmou zero manifestos de geometria britânica e nenhuma ativação do lote. O manifesto durável `coverage-gb-prepared-20261027-v3` registra a retomada sem alterar o catálogo consultado. A causa da queda do ambiente não foi determinada.

## Retomada concreta

Depois de recuperar este mesmo workspace, conferir o checkpoint local e renovar somente URLs assinadas expiradas, executar:

```bash
.artifacts/venv-catalog/bin/python scripts/catalog-publish-country.py \
  --root .artifacts/city-coverage-britain-v3-20261027 \
  --database-config .env.coverage-operations \
  --asset-config .env.britain-v3-asset-upload \
  --geometry-config .env.britain-v3-geometry-upload
```

Os seletores acima são arquivos locais privados; não estão no GitHub nem nesta prova. Não recriar o catálogo ou as contas. O publicador verifica identidades, hashes, orçamento do banco e cada etapa antes de atualizar a cobertura. Após a publicação, finalizar e verificar os fragmentos espaciais de `.artifacts/catalog-serving-gb-v3-20261027`, preservar o original e testar uma cidade pequena pela API real antes de declarar o lote utilizável.

A revisão de limites deve continuar a partir dos blocos de `.artifacts/world-boundaries-20261026/ranges-00001` e dos checkpoints existentes. Há blocos de origem ainda indisponíveis; a fonte britânica não foi declarada esgotada. A fila mundial persistida continua sendo o backlog, não um coletor executando continuamente.

## Custo, integridade e testes

O banco de operações estava com 229.048.320 bytes, sob o guard de 220 MiB e o limite gratuito efetivo de 256 MiB. A última leitura de consumo anterior à publicação indicou 4.885.295.531 de 5.000.000.000 bytes de transferência; o contador pode atualizar com atraso. Não aumentar cotas ou começar lotes grandes sem nova conferência. Índices espaciais existentes e o milhão original permanecem preservados. Nenhum plano pago foi contratado.

**77 testes Python passaram**, além das suítes de autenticação e geoespaciais/PostGIS no GitHub, commit `b9e216cd9857d2bdd86aeb0eab05dccda58b03f9`:
[geoespacial](https://github.com/eriksmoura14-ai/prospect-ai/actions/runs/40483104422) e
[autenticação](https://github.com/eriksmoura14-ai/prospect-ai/actions/runs/40483104581).
As mudanças estão na branch separada do PR 38; main e o código de produção não foram modificados.
