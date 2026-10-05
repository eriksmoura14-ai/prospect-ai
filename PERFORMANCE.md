# Otimização de carregamento e atualização

Em 2026-10-05, a aplicação relia arquivos e executava gzip síncrono a cada pedido de JavaScript/CSS. Esses arquivos usavam `no-store`, portanto um recarregamento repetia aproximadamente 215 KB de downloads. A tela também reconstruía todos os cartões a cada atualização do progresso, mesmo quando nenhuma empresa havia mudado.

## Alterações

- `static-resources.cjs` mantém uma lista explícita de recursos públicos, com leitura assíncrona, compartilhamento de pedidos concorrentes e Brotli/gzip preparados uma vez por arquivo/processo. O cache em memória é limitado por essa lista, não por URLs arbitrárias.
- HTML/JS/CSS usam `private, no-cache` e ETag: o navegador verifica a versão e recebe 304 sem corpo quando ela não mudou. Após deploy, o conteúdo novo tem um ETag novo. Imagens mantêm o cache privado de uma hora. Negociação respeita `Accept-Encoding`, inclusive `q=0`, e HEAD não envia corpo.
- `earth-loader.js` importa a cena após uma primeira pintura e uma oportunidade de o navegador ficar ocioso. Preserva texturas, geometria, viagens, qualidade, pausa e fallback. O formulário não precisa esperar pela compilação do Three.js para concluir o carregamento do documento.
- `app.js` compara as linhas e preserva cartões sem mudanças. Uma alteração em uma empresa atualiza só seu cartão; foco em outros cartões e detalhes expandidos continuam disponíveis. A memória dos cartões é limpa na expiração da sessão.
- `earth-background.js` recalcula o rótulo durante viagens, mudança de destino ou redimensionamento. Não recalcula continuamente um rótulo estacionário ou oculto no celular. Nuvens e demais animações continuam funcionando.

Autenticação continua antes do atendimento dos recursos. APIs de conta, histórico, pesquisas e listas continuam com `Cache-Control: no-store`; nenhuma resposta de cliente entra no cache de arquivos. CSP, permissões, atribuição LocationIQ e demais proteções foram preservadas. Não há novas dependências, variáveis de ambiente ou serviços pagos.

## Medições reais locais

Comparação com o commit `59cddc26abbccba90255e3482fde95aa40ed7f78`. Chromium real, backend Node real, mesma máquina, latência de 150 ms, download de 1,6 Mbps e CPU desacelerada 4×. Movimento reduzido durante o carregamento evita que a GPU por software domine a medição.

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Arquivos transferidos no recarregamento, desktop/celular | 214.587 bytes | 3.600 bytes |
| Transferência total no recarregamento, incluindo documento e APIs | 263.854 bytes | 27.877 bytes |
| DOMContentLoaded, primeiro carregamento desktop | 2.939 ms | 755 ms |
| DOMContentLoaded, primeiro carregamento celular | 2.323 ms | 715 ms |
| Primeiro carregamento, arquivos desktop | 1.909.354 bytes | 1.892.152 bytes |
| Primeiro carregamento, arquivos celular | 1.106.101 bytes | 1.088.899 bytes |
| 20 atualizações idênticas de 100 cartões, CPU 4× | 1.054 ms | 17 ms |
| Mutações na lista de cartões nessas atualizações | 2.020 | 0 |

Transferência vem de `PerformanceResourceTiming.transferSize`, que inclui a estimativa de cabeçalhos do navegador; os 3.600 bytes correspondem às revalidações dos 12 recursos de código/estilo. Texturas não tiveram resolução reduzida. Seu tamanho domina o primeiro download, portanto o maior ganho de dados está no recarregamento.

Os tempos são amostras locais, não garantias de latência em celulares físicos, da inicialização de uma instância gratuita do Render ou de fornecedores de empresas. A preparação adicional de Brotli nível 6 para os dois módulos Three.js levou cerca de 9–10 ms por módulo nesta máquina, somente no primeiro acesso de cada processo.

## Verificação e reprodução

- `npm test`: 155 testes passaram com PostgreSQL 17 local descartável, sem skips; inclui contas, CSRF, isolamento, histórico, listas, classificação e recursos estáticos. A compressão nível 6 foi verificada novamente nos testes HTTP específicos após a medição de níveis.
- `python test/prospects-browser.py`: login, listas, notas, filtros, persistência, isolamento e limpeza na expiração passaram em desktop/celular contra Node/PostgreSQL reais locais.
- `PROSPECT_BASELINE_APP=/caminho/app-anterior.js python test/performance-browser.py`: compara cartões, verifica que somente um dos 100 cartões muda, preserva foco/detalhes, filtros, habilitação do agente, limpeza de sessão, nuvens animadas e rótulo estacionário. A comparação usa linhas de empresas controladas e explicitamente não comprova disponibilidade de descoberta em produção.
- `PERFORMANCE_LABEL=current python test/loading-browser.py`: mede carregamento frio e recarregamento com as condições acima; relatório em `/tmp/prospect-performance-current.json`.
- `python test/earth-browser.py`: regressão WebGL, texturas, viagens, locais, pausa, movimento reduzido, celular e fallback.

Os scripts de interface/performance usam o servidor local em `http://127.0.0.1:3041`, iniciado com `PORT=3041 APP_ORIGIN=http://127.0.0.1:3041 npm start`, e exigem Playwright Python/Chromium. O teste de listas tem seu servidor local dedicado e exige `TEST_DATABASE_URL` de PostgreSQL descartável. Nenhuma conta, empresa ou mensagem de teste é criada em produção.
