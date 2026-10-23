# Coleta offline de um milhão de estabelecimentos — 23/10/2026

A solicitação de um milhão, sem restrição de país, foi atingida **em um conjunto offline separado**: 1.000.000 de registros de estabelecimentos após deduplicação conservadora. **Nenhum desses registros foi importado no catálogo online nesta rodada.** O banco de produção continua com 13.954 observações de fonte / 12.466 cadastros únicos conservadores e limites operacionais de 50 mil observações/64 MiB. Não se somam os dois conjuntos: pode haver sobreposição com dados anteriores.

## Resultado do arquivo final

| Métrica | Total |
|---|---:|
| Registros finais / IDs distintos da fonte | 1.000.000 |
| Com telefone público informado | 960.387 |
| Com URL de website ou perfil informada | 913.182 |
| Classificados como website informado | 902.379 |
| Somente perfil/diretório reconhecido; precisa de verificação | 10.803 |
| Com endereço informado | 993.575 |
| Com cidade informada pela fonte | 998.304 |
| Compatíveis com os 24 nichos atuais | 443.932 |
| Outros setores comerciais, para filtros futuros | 556.068 |
| Registros repetidos descartados na amostra processada | 1.551 |
| Registros com falha na validação final de país/localização/proveniência | 0 |

O recorte contém 885.399 estabelecimentos com país US, 114.600 com país CA e um com país RU. A fonte selecionada é uma partição regional da América do Norte que também alcança o extremo leste russo. Não é uma varredura planetária, cobertura nacional completa ou cadastro jurídico de empresas. Franquias com endereços diferentes podem representar estabelecimentos distintos.

## Fonte, critérios e limites

Foi usado **um único arquivo regional público** do Overture Places 2026-10-21.0, partição 00002, com 5.524.225 lugares e 814.700.009 bytes. Não foi baixado o planeta. O arquivo foi transferido em ranges HTTP verificados, com duas conexões, sem credenciais, alteração de proxy/TLS, API paga ou cartão. O limite foi 900 MiB de entrada; o SHA-256 da fonte é `46e3b2d3160e189290d0a5d02075e6b5681c54d4efbc8141f21db4a381e5c219`.

Os 79 seletores comerciais, compatíveis com os grupos atuais e setores adicionais explicitamente comerciais, localizaram 1.630.401 candidatos nomeados. Nome, situação operacional, confiança e licenças reduziram o conjunto elegível para 1.454.062. Registros permanentemente encerrados foram excluídos; confiança, quando informada, deve estar entre 0,5 e 1. Situação desconhecida/temporariamente encerrada não comprova operação atual.

O pipeline extrai o Point WKB real, valida latitude/longitude e cruza o país ISO informado pela fonte com polígonos **Natural Earth 1:10m**, de domínio público. Esses limites são generalizados, não autoridades cadastrais; pontos costeiros/fronteiriços podem ser omitidos. Cidade/estado permanecem rótulos da fonte, sem inventar coordenadas ou municípios e sem tratar um envelope como limite municipal.

A normalização tem teto de 1,1 milhão de candidatos, priorizando nichos atuais e contatos informados. Esse teto foi atingido: a diferença até o conjunto elegível não deve ser interpretada como número de localizações inválidas. Foram percorridos 1.001.551 registros normalizados até obter um milhão após remover 1.551 repetidos.

A deduplicação usa identidade da fonte, país, nome normalizado, distância de até 60 m e telefone/endereço publicado compatível. Endereços conflitantes impedem a fusão. A busca de vizinhos considera a latitude. Casos sem evidência suficiente são preservados; podem restar duplicatas. IDs descartados, IDs canônicos e proveniência estão no pacote.

## Licenças e qualidade dos contatos

A publicação Overture mantém provedores, IDs e licenças por observação: CDLA-Permissive 2.0, Apache 2.0 ou CC0. Fontes/licenças fora da lista aprovada são rejeitadas. O metadado `Overture-signals`, publicado pela própria Overture sob CDLA, informa situação operacional e não constitui uma verificação em tempo real independente. Textos completos das licenças e atribuição do publicador acompanham a distribuição.

Telefones são públicos e informados pelas fontes; **não confirmam WhatsApp**. Não houve envio de mensagens, consulta de titularidade nem verificação em massa de sites. Websites ausentes continuam como informação insuficiente, não prova de ausência. Perfis reconhecidos são marcados para revisão; uma URL classificada como website também não confirma propriedade ou disponibilidade.

Os registros de setores adicionais não são todos selecionáveis pelos filtros atuais. Além disso, o normalizador online precisa admitir explicitamente os metadados `Overture-signals` antes de ingerir observações que os contenham. O arquivo não foi apresentado como importação pronta e irrestrita no runtime existente.

## Validação e entrega

Passaram **16 testes do coletor/exportador e nove da consulta offline**, incluindo WKB inválido, nenhuma invenção de dígitos, URLs inseguras/perfis, deduplicação por evidência, conflitos de endereço, franquias distantes, vizinhos em altas latitudes, filtros, SQL parametrizado e limites. A consulta real ao arquivo por US/Denver/Pizzarias com telefone retornou os três registros solicitados.

A primeira gravação final encontrou um erro de ordenação de parâmetros do `COPY` no DuckDB. O checkpoint completo dos IDs foi preservado, o exportador foi corrigido, a regressão de entrada/destino passou e a finalização retomou sem repetir a coleta. `elapsedMs` no relatório mede somente a invocação de finalização; o tempo total da rodada não foi instrumentado.

O Parquet foi relido para conferir um milhão de IDs distintos e validar todos os pontos/proveniências. O CSV compactado também foi relido: um milhão de linhas/IDs e zero células textuais iniciadas como fórmulas nos campos verificados. Células como telefones internacionais recebem prefixo de segurança no CSV; o Parquet conserva os valores originais. A integridade do ZIP foi conferida.

O pacote tem aproximadamente 225 MB e inclui Parquet, CSV gzip, aliases, proveniência, licenças, métricas, consultas locais e scripts/testes do operador. O Parquet ocupa 137.403.018 bytes; CSV gzip, 83.044.468 bytes. O script `query.py` permite pesquisar localmente por país, cidade, nicho, coordenadas, telefone e evidência de website, sem hospedagem ou credenciais de banco.

O artefato de entrega é `/workspace/prospect-1-milhao-20261023.zip`; os checkpoints ficam em `.artifacts/catalog-million-20261023/`. Artefatos do ambiente não são hospedagem gerenciada: o pacote deve ser baixado e conservado. Não foi ativado scanner contínuo, alterado o plano, publicado código na produção ou lido histórico privado.

A conferência somente de leitura no Neon encontrou os mesmos 13.954 registros, 30.859.264 bytes de tabela/índices e 55.140.352 bytes de banco antes e depois. Nenhuma credencial foi solicitada ou utilizada para escrever no banco.

Métricas: [reports/catalog-million-20261023.json](reports/catalog-million-20261023.json). Tamanho e hash do pacote: [reports/catalog-million-package-20261023.json](reports/catalog-million-package-20261023.json).
