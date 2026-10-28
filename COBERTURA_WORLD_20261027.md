# Cobertura mundial — evidência de 27/10/2026

A meta mundial **continua incompleta**: 11,937 de 152,970 localidades têm pelo menos 50 empresas conservadoramente únicas (7.8035%). Outras 141,033 continuam abaixo da meta ou sem localização confirmada. Não foram removidas localidades do denominador para melhorar o percentual.

## Acervo preservado e ampliação publicada

Antes desta rodada DE/NL/BE/CH/CZ/PL/AT: **4.154.339** empresas únicas. Novas: **771.935**. Total: **4.926.274**, em **34 países**. Existem **4.937.165 observações de fontes** e **10.891 sobreposições identificadas**. As cópias para servir consultas e os ativos aposentados não entram novamente na soma. O arquivo original de um milhão mantém seus 137.403.018 bytes e SHA-256 `f0d691f744c9cc55b5ed7213b6f8758061ddc694334ca879406119804f520314`.

O total reúne 4.913.808 registros canônicos nos ativos ativos e 12.466 empresas adicionais líquidas do catálogo anterior. Seis observações US recebidas desde o snapshot anterior foram conferidas por identidade: todas já existiam nos arquivos, portanto não viraram seis empresas novas.

| País | Novas empresas únicas | Localidades com limites confirmados/inventário | ≥50 | ≥100 | ≥200 |
|---|---:|---:|---:|---:|---:|
| DE | 410,562 | 6,049/7,104 | 1,270 | 555 | 183 |
| NL | 83,151 | 1,079/1,644 | 262 | 134 | 54 |
| BE | 74,791 | 479/549 | 260 | 122 | 39 |
| CH | 51,999 | 892/1,507 | 147 | 64 | 22 |
| CZ | 30,814 | 1,055/1,355 | 70 | 29 | 9 |
| PL | 74,624 | 2,440/2,810 | 256 | 112 | 45 |
| AT | 45,994 | 1,539/2,360 | 93 | 24 | 2 |

Os vínculos geográficos não significam que a meta comercial foi atingida. O inventário completo tem **223 países com localidades e 4.279 subdivisões com localidades**; os demais países/subdivisões disponíveis no seletor não foram inventados como cidades. Há 58,289 localidades com algum registro confirmado, 86,874 com localização pendente, 54,157 parciais e 2 falhas temporárias. ≥100: 6,316 (4.1289%); ≥200: 3,006 (1.9651%).

Das novas empresas, 713,731 têm telefone publicado, 516,413 têm website informado, 764,106 têm endereço e 771,935 têm coordenadas válidas. São dados coletados de fontes públicas, sem confirmação de conta WhatsApp, funcionamento do website ou verificação humana de cada estabelecimento.

## Mudanças implementadas

- O plano de fontes usa o polígono completo do país e todas as partições intersectantes. Corrigiu a omissão do extrato oeste dos Países Baixos e da Bélgica. Não baixa empresas por cidade ou segmento repetidamente.
- O cruzamento exige país, ISO do estado, nome primário/comum e coordenada do aplicativo dentro do polígono territorial. Homônimos, limites conflitantes e objetos acima do orçamento continuam pendentes.
- Leituras de divisões têm cache verificado por hash, orçamento de rede e janelas retomáveis. O planejamento de cache não promete que o leitor dispensará bytes adicionais: a leitura offline real é obrigatória.
- A ampliação explícita de um país preserva os vínculos anteriores ou interrompe em caso de conflito. A Tchéquia passou de 491 para 1.055 vínculos, preservando os 491 anteriores e o mesmo Parquet comercial byte a byte.
- O publicador de país verifica arquivos, destinos assinados, banco público isolado, orçamento físico, identidade do ativo existente e SHA-256 remoto antes de ativar dados. Checkpoints e trava local permitem retomar sem recomeçar o lote. Atualizações só de geografia têm checkpoint separado e não recontam empresas.
- Geometrias novas são comprimidas com gzip; o backend continua validando os bytes decodificados pelo hash original. A fila materializa até 250 novas tarefas por execução e mantém o inventário completo como backlog, respeitando 50.000 tarefas ativas e o limite físico de 220 MiB.

A interface, autenticação, exportações, telefones e histórico não foram substituídos. O código principal de produção permanece no commit `7cf5faea13d07b8ca94a39681e5df075721ecd43`. As mudanças de código estão na [PR 38](https://github.com/eriksmoura14-ai/prospect-ai/pull/38); os arquivos comerciais já estão no armazenamento durável consultado pelo backend.

## Fontes e integridade

Empresas: Overture Places 2026-10-21.0, apenas categorias suportadas e proveniência permitida por registro; CDLA-Permissive-2.0, Apache-2.0 e CC0-1.0 conforme a origem preservada. Limites: Overture divisions com OpenStreetMap/geoBoundaries e ODbL-1.0, mantendo as licenças originais e atribuições. Ver [CATALOG_ATTRIBUTIONS.md](CATALOG_ATTRIBUTIONS.md).

O plano mundial contempla as 152.970 localidades: 223 planos por país, 217 com polígono nacional para planejamento e seis territórios com revisão pendente (BQ, GF, GP, MQ, RE, YT). Isso **não** certifica limites municipais nem descoberta comercial em 217 países. A API pública do Nominatim não foi usada para geocodificar sistematicamente o inventário. Não houve raspagem do Google Maps, contratação ou habilitação de cobrança.

## Testes reais e limites dos contadores

Budel/NL: 50 empresas únicas no serviço existente, 48 com telefone, 32 com website, 49 com endereço; 84,104 s para a união dos 24 segmentos. Kruibeke/BE: 50, com 43 telefones, 32 websites e 48 endereços; 104,932 s. Donzdorf/DE: 50; evidência preservada da primeira etapa desta rodada.

Suchy Las/PL: o catálogo certifica 50 associações sem ambiguidade. A busca retorna 55 registros dentro do polígono: cinco também pertencem a áreas administrativas sobrepostas e ficaram fora da contagem certificada. A extração local identificou precisamente os cinco; a união dos IDs retornados pela aplicação coincidiu com o SHA-256 esperado `d50a2d9eb2d12f16e8ea547cf3a6f5a10aa054b7bacb04be42a14938230302b8`. Isso não criou cinco empresas adicionais nem aumentou artificialmente a cobertura.

Wattwil/CH retornou 50 empresas. Judenburg/AT retornou 51, com 43 telefones, 28 websites e 51 endereços. A pesquisa normal do aplicativo encontrou 20 restaurantes no ativo austríaco e entregou as 10 linhas solicitadas em 13,391 s, com `archive:true`; não precisou depender de uma nova consulta pública.

Foram aprovados **60 testes Python locais**, incluindo retomada após falhas, preservação das identidades, colisões de ativos e isolamento do catálogo público. As verificações de autenticação e PostGIS também são executadas no CI da branch.

Os relatórios das verificações ficam em `live-city-verification.json`. A primeira comparação polonesa, que esperava 50, falhou de fato; a evidência da diferença e a comparação posterior por identidade foram mantidas. Os testes reais devem rodar em série, pois o serviço gratuito limita o leitor a uma consulta simultânea. Falhas 503 causadas por concorrência não são resultados vazios de empresas.

As regressões automatizadas verificam identidade, buracos, homônimos, cache e orçamento, preservação de ativos, retomada, isolamento de credenciais, colisões de catálogo e atualizações de geografia. Resultados e comando estão no pacote de evidências. Nenhum teste fictício entra no acervo comercial.

## Recursos e continuação

Foram publicados 99.744.819 bytes de novos Parquets e 337 documentos geográficos ativos nesta rodada, com 292.440.109 bytes decodificados; versões anteriores permanecem preservadas. O banco público mede 228.442.112 bytes, abaixo do guard de 230.686.720. Antes do pacote final, o bucket tinha 944 objetos e 2.785.736.882 bytes. A quota continua Free: transferência configurada em 5 GB, consumo reportado de 4.450.692.148 bytes, contador sujeito a atraso. O disco local tem aproximadamente 1,3 GiB livres; verificar orçamento e caches reproduzíveis antes de outro extrato grande.

A velocidade de conciliação está medida por país em `country-report.json` (`elapsedMs`); ela exclui download, revisão de fontes e publicação e não representa a velocidade de uma coleta mundial completa. O extrato de empresas 00011 foi baixado uma vez, com 714.390.669 bytes, e reutilizado. Interrupções 503 do túnel do executor foram registradas; lotes continuaram pelos checkpoints quando a conexão voltou.

Existem três exceções auditadas abaixo de 50, separadas da meta: localidades francesas desabitadas. Não é possível garantir 50 empresas reais em toda entrada do seletor, e não foram usados vizinhos ou registros inventados para preencher cotas. As demais localidades pendentes ainda exigem revisão de limites e/ou fontes adicionais. Uma resposta completa de um provedor não foi tratada como prova de cobertura comercial total.

Para retomar uma publicação preparada, usar o comando exato e os seletores privados descritos em [CITY_COVERAGE_RUNBOOK.md](CITY_COVERAGE_RUNBOOK.md). Para conferir todo o inventário:

```bash
.artifacts/venv-catalog/bin/python scripts/catalog-coverage-audit.py \
  --root .artifacts/catalog-audit-world-20261027 \
  < .env.coverage-operations
```

O mecanismo permite retomada; **não existe varredura mundial contínua nem worker automático configurado**. Não há promessa de coleta após o encerramento da sessão.

[Baixar o pacote público de evidências e o inventário completo](https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/archives/20261027/coverage-world-v1.zip). Ele referencia os ativos já publicados, sem duplicar o acervo nem incluir credenciais.
