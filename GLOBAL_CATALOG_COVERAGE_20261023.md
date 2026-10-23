# Catálogo e cobertura — rodada de 23/10/2026

O milhão original foi preservado byte a byte. Foram acrescentadas **1.205.442 empresas únicas** pelos critérios conservadores abaixo. O acervo reconciliado passou a **2.217.908 empresas**. Os dados novos estão publicados em armazenamento durável; a integração do aplicativo foi implementada e testada nesta branch. **A aplicação de produção, a main e a base de autenticação não foram alteradas.**

## Contagem e preservação

| Medida | Antes | Acrescentado nesta rodada | Final |
|---|---:|---:|---:|
| Empresas únicas pelas regras documentadas | 1.012.466 | 1.205.442 | 2.217.908 |
| Observações de fontes, incluindo sobreposições | 1.013.954 | 1.208.524 | 2.222.478 |
| Sobreposições identificadas | 1.488 | 3.082 | 4.570 |

O acervo anterior consistia em dois conjuntos: Parquet com 1.000.000 identidades Overture (US 885.399, CA 114.600, RU 1) e 13.954 observações no catálogo PostgreSQL existente, equivalentes a 12.466 entidades conservadoras. Os 1.551 aliases removidos na coleta original anterior continuam no arquivo original; não são novamente contados como descobertas desta rodada.

O Parquet original mantém SHA-256 `f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`, 137.403.018 bytes. IDs Overture, IDs OSM, registros e proveniência anteriores foram preservados. O PostgreSQL antigo continua com 13.954 observações, sem escrita nesta tarefa.

Os quatro arquivos incrementais contêm 459.429, 438.154, 183.691 e 124.168 novas entidades. Observações sobrepostas foram preservadas nos arquivos normalizados e no índice de aliases, em vez de serem contadas novamente como empresas. Filiais com endereços conflitantes não são fundidas. OSM mantém a identidade `node/way/relation`, independentemente de ter sido obtido por QLever, Overpass ou Geofabrik. Entre identidades distintas, a regra exige mesmo país, nome normalizado igual, distância de até 60 m e telefone compartilhado ou endereço igual, sem conflito de endereço. Correspondências incertas podem permanecer separadas; isto não é uma verificação jurídica de identidade empresarial.

Há registros em 26 países no conjunto combinado; a expansão desta rodada foi em US (+1.115.552) e CA (+89.890). As demais coleções foram preservadas. Isso **não** significa cobertura completa de 26 países.

## Inventário completo e metas

O denominador é a lista real da aplicação: `@countrystatecity/countries@1.0.9`, 250 opções de países/territórios, 5.308 subdivisões e **152.970 localidades enumeráveis**. Entrada manual não é enumerável e não entra no denominador. O inventário inteiro está em `catalog_city_inventory`, inclusive localidades ainda não processadas.

| Meta somando os segmentos suportados | Antes | Agora | % das 152.970 localidades |
|---|---:|---:|---:|
| Pelo menos 50 empresas | 1.378 | 4.592 | 3,0019% |
| Pelo menos 100 empresas | 788 | 2.627 | 1,7173% |
| Pelo menos 200 empresas | 392 | 1.305 | 0,8531% |

Essas contagens são cumulativas, não devem ser somadas. Há aliases na lista da aplicação: os valores correspondem a 4.568, 2.607 e 1.289 áreas oficiais distintas, respectivamente. Todos os 4.592 resultados de meta 50 possuem registros em pelo menos três segmentos do filtro; segmentos alimentícios podem se sobrepor. Não se impôs uma cota por segmento, não se limitou uma cidade a 200 e não se espalharam empresas pelas cidades vizinhas.

| Situação no inventário inteiro | Localidades |
|---|---:|
| Meta 50 atingida | 4.592 |
| Coleta regional parcial, abaixo de 50 | 10.996 |
| Falha temporária no complemento, abaixo de 50 | 2 |
| Associação ao limite geográfico pendente | 137.380 |

15.590 entradas foram vinculadas a 15.564 polígonos oficiais distintos. 14.956 entradas possuem pelo menos uma empresa de segmento suportado dentro do polígono. No Canadá há 736 entradas mapeadas e 256 com meta 50; nos EUA, 14.854 e 4.336. As 137.380 pendências incluem países ainda sem cruzamento oficial nesta rodada e 2.221 entradas US/CA com nome/âncora não confirmado ou geometria acima do orçamento. Pendência não equivale a zero empresas.

Associação exige país, estado, nome/alias controlado **e âncora da lista dentro do polígono oficial**. Empresas entram nas contagens por coordenadas dentro desse polígono e país compatível. Pontos ambíguos ou fora das áreas confirmadas permanecem pendentes. Rótulos de cidade publicados pela fonte ficam preservados separadamente; não são utilizados como prova municipal.

Foram usados Census Places US 2024 (inclui CDPs estatísticos) e Census Subdivisions Statistics Canada 2021. Polígonos cartográficos não são levantamento cadastral atual. Buracos e ilhas são respeitados. Não foi usado Nominatim em massa, nem raio uniforme para representar cidades. A filtragem nacional Natural Earth é generalizada e pode omitir pontos costeiros; 2.232 candidatos do lote anterior foram recuperados com prova por polígono oficial. Recuperar casos costeiros dos outros lotes continua sendo trabalho possível.

Bassano e Irricana, Alberta, foram consultadas adicionalmente via duas instâncias Overpass. Nenhuma concluiu a resposta dentro do orçamento; os registros disponíveis foram mantidos e as falhas foram persistidas como `temporary_failure`, sem interpretar timeout como ausência. Os demais casos abaixo de 50 continuam `partial`; nenhuma suposta varredura completa foi declarada. O CSV integral fornece quantidade, segmentos, status, motivo e chave de cada localidade; o banco também guarda fontes consultadas e próxima ação.

## Fontes, licenças e qualidade

Processados cinco novos Parquet regionais Overture `2026-10-21.0`: 00003, 00001, 00006, 00005, 00000. O 00002 já existente foi reutilizado. Cada região foi baixada uma vez, em blocos com checkpoint, com no máximo duas conexões; não houve download por cidade/nicho nem download do planeta. Foram aceitos estabelecimentos nomeados, nas categorias suportadas, com coordenadas válidas, país compatível, confiança >=0,5 quando publicada e sem status de fechamento permanente. Ausência de telefone ou site não elimina uma empresa.

Licenças e atribuições Overture/CDLA-Permissive-2.0, Apache-2.0 e CC0-1.0 são preservadas por registro. Providers desconhecidos são rejeitados. O dataset `overture-signals` foi aceito apenas para o sinal de status operacional da release revisada. Não houve scraping do Google, CAPTCHA ou aquisição paga.

O catálogo OSM anterior e seus metadados continuam separados sob ODbL-1.0, © OpenStreetMap contributors. Material de correspondência derivado do OSM deve manter essa atribuição e os termos ODbL; arquivos Overture independentes mantêm suas licenças originais. As evidências/licenças Census, Statistics Canada e Natural Earth estão no pacote. Nenhuma licença ausente foi tratada como autorização genérica para reutilização de uma fonte nova.

O conjunto Parquet consultável tem 2.205.442 registros canônicos: 2.054.689 com telefone publicado; 1.868.508 com website/perfil publicado, dos quais 1.843.099 classificados como website; 2.187.918 com endereço; todos com coordenadas válidas. **1.649.374** correspondem aos segmentos atuais. Os 556.068 registros de outros setores do milhão anterior foram preservados. Acrescentam-se as 12.466 entidades conservadoras do PostgreSQL existente. Publicação de contato não confirma WhatsApp, disponibilidade atual ou identidade do website. Ausência de website na fonte continua `insufficient_information`, nunca prova automática de empresa sem site. Datas de descoberta e observação são preservadas; data de verificação continua nula quando não houve verificação.

## Persistência e aplicação

- Catálogo antigo: projeto Neon `long-thunder-13553096`, base `prospect_catalog`; os limites existentes de 50.000 observações/64 MiB não foram aumentados.
- Novo controle geográfico: projeto gratuito `polished-sky-36508370`, base isolada `catalog_ops`, PostGIS, migração `db/catalog-archive.sql`. Inventário, geometrias, assets, tarefas, estados e manifestos são duráveis.
- Arquivos comerciais: bucket público `prospect-public-catalog` na mesma nova branch Neon, arquivos imutáveis com SHA-256 e metadados. [Parquet original preservado](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/snapshots/20261023/million-f0d691f744c9cc55.parquet).
- [Pacote completo desta rodada](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261023/coverage-complete-v1.zip): catálogo, incrementos, observações normalizadas, inventário, limites, aliases, métricas, licenças e scripts. [Pacote original do milhão](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261023/million-93886c0b3ea212f3.zip).

O backend desta branch consulta o catálogo antigo e o arquivo regional, filtra o polígono completo antes de limitar resultados, combina a proveniência e reutiliza dados suficientes sem repetir fontes externas. País/estado/cidade são resolvidos pelo registro oficial quando disponível, com fallback interativo existente. Área oficial não é transformada em um ID OSM fictício para QLever. Falha no arquivo preserva a consulta antiga e mantém a cobertura parcial.

`GET /api/catalog/page?country=CA&state=ON&cityId=16446&niche=Restaurantes&limit=50` exige a autenticação existente. Páginas de 1–250 registros; cursor vinculado ao polígono, segmento e versão dos arquivos. Uma expansão entre páginas devolve 409 para reiniciar, em vez de misturar versões. O navegador não recebe o catálogo inteiro. O leitor usa DuckDB 128 MiB, uma thread, geometria completa, saída <=8 MiB e cache verificado de até 512 MiB. A primeira leitura pode baixar arquivos; a cache é efêmera, o acervo de origem é durável.

Só o backend recebe `CATALOG_ARCHIVE_DATABASE_URL`, de um papel exclusivo com SELECT e sem associação a `neon_superuser` ou permissão de escrita. Senha independente, não colocada em frontend, Git ou pacote. A autenticação e o banco de contas permanecem independentes. A configuração pronta do leitor ficou apenas em `.env.catalog-archive` local, ignorado pelo Git.

Para publicar a integração após revisão, manter as variáveis atuais e configurar no backend Render: `CATALOG_ARCHIVE_DATABASE_URL` (segredo de leitura), `DISCOVERY_INSTALL_ARCHIVE=true`, `DISCOVERY_INSTALL_OVERTURE=true`, `OVERTURE_PYTHON=.venv-discovery/bin/python` e `DUCKDB_EXTENSION_DIRECTORY=.duckdb-extensions`. `DISCOVERY_READ_HTTP=true` é opcional para ambiente sem saída PostgreSQL TCP; mutações continuam pelo pg existente. Não aplicar migração na base de autenticação. Frontend Vercel/Netlify continua apontando para o backend atual.

## Verificação e recursos

Testes reais usaram dados remotos duráveis, servidos pelo próprio `server.cjs` desta branch, com autenticação local e sem acesso ao banco privado de contas. Gananoque/ON: 24 restaurantes no catálogo, 10 retornados pelo job real `/api/search`, estado `done`, descoberta de 1.983 ms e consulta local de 781 ms. Goderich/ON e Brazil/IN também retornaram 10 restaurantes. Paginação autenticada retornou cinco registros e cursor. Primeiras leituras frias levaram 5–26 s, inclusive download; isto não promete latência constante em Render gratuito. Análise posterior de websites conserva seu prazo existente e não está incluída no tempo de descoberta.

309 testes Node passaram na suíte inteira (dois testes de integração PostGIS locais foram pulados sem a base de teste); os 36 testes direcionados e os 12 testes Python de leitores também passaram. A nova migração foi exercitada primeiro em uma branch Neon de desenvolvimento com PostGIS real, antes do banco novo. Regressões cobrem fronteiras, buracos, país errado, paginação, troca de snapshot entre páginas, origem permitida dos arquivos, preservação de datas e ausência de contatos. CI geoespacial inclui os testes novos. Um ensaio separado com `--country-code CA` processou 57.201 registros do lote 00003 em saída isolada e confirmou que a seleção de país não sobrescreve a coleta US/CA nem acrescenta duplicatas ao catálogo.

Download dos cinco novos lotes: 3.842.962.279 bytes em 89,592 s somados. Normalização: 576,822 s somados. Conciliação final: 120,521 s, 18.440,5 observações/s. Soma dessas etapas: 786,935 s (~13,1 min); exclui auditoria, infraestrutura, testes, tentativas de exportação e conciliações intermediárias. Uma exportação com ordenação larga excedeu 512 MiB; foi substituída por gravação em fluxo, sem elevar o limite, e o arquivo incompleto não foi publicado.

Parquet consultável: 310.693.092 bytes (296,3 MiB). Banco novo após inventário e fila: 193.667.072 bytes (184,7 MiB), abaixo da guarda de 220 MiB e do orçamento de 256 MiB. Índices detalhados estão em `ops-audit.json`; índice espacial das áreas: 679.936 bytes. O ambiente manteve aproximadamente 12 GiB livres antes do pacote. Novos objetos e backups ficam abaixo da franquia gratuita de 5 GiB de object storage consultada na documentação; nenhuma cobrança/cartão/plano pago foi habilitado. Gratuidade não foi tratada como espaço ou execução ilimitados.

## Retomada e pendências

Seis tarefas regionais estão concluídas com hash/checkpoint dos inputs e arquivos publicados. A fila contém 10.998 localidades na rodada 50, 1.965 na rodada 100 e 1.322 na rodada 200; 591 tarefas anteriores atingiram 200 via importação e foram encerradas. Há 223 tarefas de revisão de limites por país bloqueadas até escolha de fonte, licença, região e orçamento. A associação pendente inclui casos US/CA; não representa 223 países totalmente novos. Concessões têm token/prazo, no máximo três tentativas e espera após falha.

**Não há processo contínuo ou cron configurado.** A execução desta tarefa terminou; estes comandos são a forma explícita de continuar. Após extrair o pacote, no diretório do projeto:

```sh
python3 -m venv .venv-catalog
.venv-catalog/bin/pip install -r tools/catalog-requirements.txt
# Exemplo de retomada de região: reutiliza download completo verificado/chunks.
.venv-catalog/bin/python scripts/catalog-download.py --region .artifacts/coverage-20261023/region-00006
.venv-catalog/bin/python scripts/catalog-region.py --region .artifacts/coverage-20261023/region-00006 --baseline .artifacts/catalog-million-20261023/prospect-businesses.parquet --countries .artifacts/catalog-million-20261023/countries-natural-earth.geojson --niches .artifacts/coverage-20261023/niches.json
```

Essas regiões já foram concluídas. Para nova região, adicionar o item STAC revisado da release fixada em `source-asset.json`, respeitar os limites de download e escolher os países explicitamente com `--country-code XX` (saída separada por país, sem sobrescrever US/CA). Não ativar um loop mundial. Para conciliar todos os inputs desta rodada, preservando os incrementos publicados:

```sh
.venv-catalog/bin/python scripts/catalog-coverage.py --extra-region .artifacts/coverage-20261023/region-00001/normalized.parquet --extra-region .artifacts/coverage-20261023/region-00006/normalized.parquet --extra-region .artifacts/coverage-20261023/region-00005/normalized.parquet --extra-region .artifacts/coverage-20261023/region-00000/normalized.parquet --output new-businesses-round4.parquet --exclude-published .artifacts/coverage-20261023/new-businesses.parquet --exclude-published .artifacts/coverage-20261023/new-businesses-round2.parquet --exclude-published .artifacts/coverage-20261023/new-businesses-round3.parquet
```

O comando não insere novamente os registros publicados. Não remover o `--exclude-published` ao produzir um incremento seguinte. Downloads completos são reutilizados após hash; tabelas de estágio são reutilizadas. Uma conciliação interrompida refaz somente a conciliação a partir dos Parquet normalizados, sem reiniciar downloads. Arquivos de saída são publicados somente após conclusão/validação, por caminho imutável.

`catalog-ops.py claim` recebe JSON pela entrada padrão com `url` da base isolada e `taskId` opcional; devolve tarefa/checkpoint/token. `checkpoint` exige o mesmo token e lease vigente. `catalog-complement.py --input .artifacts/coverage-20261023/complement-sample.json --output .artifacts/coverage-20261023/complement` executa um lote pequeno de consultas OSM compiladas pelos seletores do aplicativo, com orçamento total de 90 s. Não reivindicar mais tarefas que se possa concluir; consultar fontes públicas exige respeitar o backoff informado.

Publicação de novos dados é explícita: obter URL de upload assinada do bucket pela integração Neon; fornecer a `catalog-upload.py` via stdin, com caminho e SHA; registrar metadados por `catalog-ops.py asset`; atualizar cobertura por `catalog-ops.py coverage`; registrar manifesto e finalizar a etapa. URLs de banco/assinatura nunca vão em argumentos ou logs. Os comandos de escrita pedem a credencial de operações, não o papel de leitura da aplicação. Nenhum worker mundial ou publicação automática em produção foi configurado.

Próximo trabalho: complementar primeiro as 10.998 localidades abaixo de 50, recuperar pontos costeiros dos outros lotes e resolver nomes/âncoras pendentes; depois revisar limites oficiais dos outros países e importar regiões licenciadas. Fontes OSM compartilham a mesma base e não contam como empresas novas por simples troca de endpoint. Os status e CSV permitem priorizar cidades pequenas sem forçar cotas ou declarar inexistência de empresas.
