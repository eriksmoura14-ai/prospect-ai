# Terra animada

A versão 0.4 mostra uma Terra 3D ao fundo, com estrelas, atmosfera e iluminação. Sem seleção, o globo gira lentamente. Selecionar país, estado/província e cidade orienta o planeta para o destino, aumenta gradualmente sua escala e mostra um marcador. O título e os controles ficam sobre painéis escuros translúcidos.

Os filtros emitem `prospect:location` com coordenadas do catálogo mundial já instalado. Esses pontos são referências visuais aproximadas e não definem nem reduzem a área da busca de empresas. O payload de pesquisa, o geocodificador, as regras comerciais e o agente de IA permanecem com suas funções existentes. Nomes manuais ou coordenadas ausentes mantêm o estado/país como contexto; quando uma pesquisa fornece um ponto geocodificado, o fundo acompanha esse ponto. Editar o nome manual remove o alvo anterior. Uma pesquisa em cache reaproveita o ponto do cache de geocodificação sem fazer outra chamada externa.

Os módulos Three.js e as duas texturas são servidos pelo próprio backend, sob a autenticação da aplicação. A animação não consulta fornecedores externos por quadro ou por seleção. Three.js é fixado em 0.180.0, com licença MIT; as texturas são NASA Blue Marble e NASA/NOAA Black Marble. Fontes, créditos, licença e processamento estão em [assets/NOTICE.md](assets/NOTICE.md). A textura noturna contém observações históricas de 2016, usadas somente como decoração.

## Movimento e celular

“Pausar animação” interrompe o movimento contínuo; as seleções continuam funcionando. A preferência do sistema por movimento reduzido torna os deslocamentos instantâneos e renderiza somente quando necessário. Abas ocultas suspendem os quadros. Em celulares, o renderer limita a resolução e o rótulo do globo fica oculto para manter o título legível; a cidade continua visível no seletor. Sem WebGL, com falha de textura ou perda de contexto gráfico, permanece um fundo estático com o formulário funcionando.

## Verificação

- Instalação: `npm ci --ignore-scripts`.
- Sintaxe e backend: `npm test`, 110 testes passando nesta versão.
- Navegador opcional: `PORT=3041 APP_ORIGIN=http://127.0.0.1:3041 npm start`, seguido de `python test/earth-browser.py`; precisa de Playwright Python e Chromium. O script passou 10 cenários com WebGL real via SwiftShader, metadados locais reais e zero pedidos de empresas. Exercita países/cidades, viagem, respostas atrasadas, edição manual, pausa, movimento reduzido, celular, ausência de WebGL e perda de contexto.
- Os 13 cenários de `test/location-browser.py` também passaram; respostas de jobs nesse teste são somente fixtures da interface.

Esses testes verificam a animação e a integração do formulário, sem alegar uma nova comprovação de descoberta de empresas em produção.
