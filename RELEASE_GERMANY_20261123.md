# Publicação do catálogo alemão

Esta entrega parte da main atual e preserva os arquivos de interface. Inclui o leitor OSM, a seleção municipal por AGS, geometrias comprimidas verificadas, paginação limitada e os testes correspondentes da PR #40.

O tráfego gratuito do Neon está próximo do limite. Os três Parquets alemães são espelhados em uma release pública do próprio projeto, com os mesmos bytes, SHA-256, licenças e identificadores comerciais. A fonte continua sendo Overture/OSM; GitHub é apenas o transporte. Arquivos originais e metadados históricos permanecem preservados.

A preparação usa uma branch de dados isolada, sem credenciais. O workflow `catalog-germany-mirror.yml` aceita somente os três hashes revisados, confere cada parte e o arquivo completo antes de publicar a release. Não executa código da branch de dados. O leitor permite apenas a release específica e redirecionamentos HTTPS aos hosts oficiais de assets do GitHub, sem credenciais. Limites de cache, memória e tamanho não foram elevados.

Ordem de publicação: CI aprovado → merge do código → deploy Render live e `/health` válido → publicação dos três arquivos na release → verificação dos hashes da release → troca atômica dos assets alemães por seus espelhos, habilitando o lote novo → buscas reais. Nenhum contador municipal deve ser promovido antes da ativação.

O cadastro Google é uma alteração separada; as credenciais do cliente OAuth precisam ser configuradas pelo titular no Google Cloud/Render. A senha atual e os dados das contas continuam preservados.
