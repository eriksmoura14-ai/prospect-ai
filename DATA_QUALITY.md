# Qualidade dos contatos e sites

Investigação e validação em 2026-10-05.

## Causas encontradas no código

- A descoberta só lia `phone` e `contact:phone`. Ignorava `mobile`, `contact:mobile`, WhatsApp explicitamente cadastrado e contatos normalizados quando presentes na resposta do provedor.
- Uma URL cadastrada recebia confiança 1 e saía da verificação imediatamente. Isso não verificava disponibilidade nem identidade.
- A ausência dos poucos domínios sugeridos podia virar `LIKELY_NO_WEBSITE`. Esses candidatos não cobrem todos os sites possíveis, e não incluíam `.com.br`.
- A deduplicação juntava empresas próximas com o mesmo nome, mesmo com endereços diferentes. A normalização também apagava nomes em alfabetos não latinos.
- O limite de leitura de 393.216 bytes impedia verificar algumas páginas públicas comuns.

## Evidência pública real

Foram feitos GETs curtos, com proxy e TLS verificado, sem chaves nem login de clientes.

1. [Shake Shack, node/11842373513](https://api.openstreetmap.org/api/0.6/node/11842373513.json): HTTP 200. O cadastro de 820 Washington Street, New York, não trouxe telefone nem website. O registro retornado tinha atualização em 2024-10-09. Ausência de campos não permite concluir ausência de contatos.
2. [Joe's Pizza, node/931799207](https://api.openstreetmap.org/api/0.6/node/931799207.json): HTTP 200. O cadastro de 7 Carmine Street trouxe telefone e `https://www.joespizzanyc.com/`; atualização do registro em 2023-11-04.
3. [robots.txt](https://www.joespizzanyc.com/robots.txt): HTTP 200, texto simples; a política permite o caminho `/` para o robô do aplicativo. A [página](https://www.joespizzanyc.com/) retornou HTTP 200, 425.344 bytes, acima do limite antigo. A análise local dessa resposta real encontrou nome, cidade e endereço compatíveis. Não encontrou correspondência suficiente para confirmar o telefone da fonte; nenhum número foi inventado ou acrescentado.

Essas consultas foram feitas fora do Render. São evidência de dados públicos e de uma página maior que o limite antigo; não são uma busca autenticada de produção nem prova de precisão mundial.

## Comportamento corrigido

- Contatos adicionais são preservados com sua origem. Os campos opcionais normalizados do Geoapify permanecem separados das tags OSM; não há fabricação de tags de classificação ou novas chamadas pagas ao provedor.
- Sites cadastrados passam pela verificação. `Site na fonte`, `Site compatível`, `Perfil na fonte` e `Site não confirmado` têm significados diferentes. Perfis sociais e diretórios não comprovam domínio próprio.
- Telefones são comparados por número internacional completo, individualmente. O WhatsApp explicitamente cadastrado tem prioridade; quando aplicável, um número que coincide com a página precede outro telefone não confirmado.
- Um telefone ausente só é acrescentado de um cadastro estruturado público que corresponde ao nome, cidade e rua/número da empresa. Rodapés de desenvolvedores, outras empresas, outras filiais e múltiplos números ambíguos não fornecem esse contato.
- Uma divergência conserva o telefone da fonte e o telefone do site para revisão; desativa o destino automático de WhatsApp. Nenhuma conta WhatsApp, titularidade ou atualização cadastral é confirmada pelo aplicativo.
- Domínios nacionais ampliam os candidatos. Nenhuma lista de candidatos negativos comprova inexistência de site; o resultado continua incerto.
- Cada página e redirecionamento respeita `robots.txt` e a validação DNS/IP já existente. Não há leitura de rede privada, login em sites ou envio automático de mensagens.
- Leitura de página limitada a 768 KiB; cache limitado a 32 entradas e 8 MiB de conteúdo. Permanecem três verificações simultâneas, 12 segundos por site cadastrado e 25 segundos por busca de candidatos.
- Origem e qualidade persistem cifradas nas listas e no histórico e aparecem nas exportações. Histórico anterior mostra a necessidade de refazer a busca para aplicar os critérios atuais. Caches anteriores de descoberta/verificação não são reaproveitados pelas novas buscas.

O agente, as definições dos 24 nichos, seus critérios de classificação, o orçamento de páginas do provedor e os limites geográficos das consultas permanecem preservados.

## Validação

- `npm test`: 223 testes passaram, zero falhas ou testes ignorados, com PostgreSQL local descartável real. Inclui origem/cifra dos contatos, isolamento entre contas, filiais distintas, Unicode, números internacionais, respostas vazias/erros, limites de leitura/cache, restrições de robots e bloqueio SSRF.
- Chromium local, computador e celular: 16 casos de qualidade dos dados; regressões do dashboard, WhatsApp e seis cenários de expiração de sessão também passaram. Contas e empresas dessas regressões são fictícias; destinos externos são interceptados ou proibidos.
- Desempenho: 100 cartões conservaram os mesmos elementos em 20 atualizações sem mudança de dados, com zero mutações DOM. Globo e interface continuaram funcionando.
- A conferência do deploy e dos arquivos públicos verifica a publicação da versão testada. Não substitui validar empresas reais em uma nova busca autenticada no serviço.

## Arquivos para atualização

Runtime: `server.cjs`, `contacts.cjs`, `geoapify.cjs`, `website-evidence.cjs` (novo), `prospects.cjs`, `prospects-ui.js`, `app.js`, `index.html`.

Testes: `test/accounts.postgres.test.cjs`, `test/contacts.test.cjs`, `test/discovery.test.cjs`, `test/geoapify.test.cjs`, `test/security.test.cjs`, `test/website-evidence.test.cjs` (novo), `test/contact-quality-browser.py` (novo).

Documentação: este arquivo. Nenhuma migração de banco, chave nova ou variável de ambiente adicional é necessária.

## Limitação restante

O OpenStreetMap e o índice do Geoapify podem omitir contatos, incluir cadastros antigos ou ter cobertura desigual. Páginas podem ser indisponíveis, bloqueadas para robôs, grandes demais ou ambíguas. Nesses casos o sistema informa a incerteza. A correção melhora coleta e verificação; não cria uma base completa de telefones e sites nem comprova que todos os casos relatados foram resolvidos. Não houve acesso a novos resultados privados de clientes durante esta investigação.
