# Segurança do Prospect AI

Revisão de 2026-10-05. As alterações não exigem plano pago, novas variáveis de ambiente ou migração do banco.

## Problemas reproduzidos e correções

**Resposta atrasada após o fim da sessão.** Em Chromium, com Node e PostgreSQL locais reais, uma resposta autorizada de histórico foi retida; a sessão foi revogada no banco e a interface encerrada. Ao entregar a resposta, o código anterior recolocava um botão de histórico na página. A interface agora identifica a geração da sessão e descarta respostas antigas de histórico, empresas, preferências e IA. Uma busca que falha depois da expiração também não pode restaurar os resultados anteriores. Encerrar a sessão limpa os cartões, diálogos privados e campos de senha. Essa reprodução encontrou exposição na interface; não demonstrou acesso do servidor aos dados de outra conta.

**CPU excessiva ao analisar HTML externo.** O extrator anterior usava regex com tentativas repetidas para tags sem fechamento: páginas de 8, 16 e 32 KiB contendo somente `<` demoraram aproximadamente 38, 149 e 600 ms, respectivamente, na medição local. O verificador agora percorre as tags em tempo linear. Testes com HTML malformado até o limite de leitura de 384 KiB terminam dentro do prazo do processo de teste. A correspondência continua usando o título completo; apenas o título apresentado nas evidências tem limite de 400 caracteres. O cache de verificação passa para `v3`. Descoberta, área geográfica, categorias, decisões de classificação e agente de IA permanecem iguais.

**Solicitações que trocam cookies.** Além dos limites existentes por Gmail e navegador, a aplicação agora limita trabalho antes de consultar a sessão/banco. Esses limites são agregados, com estado de tamanho fixo; não dependem de cookies nem de cabeçalhos de IP enviados pelo cliente.

## Limites em modo de contas

| Recurso | Limite |
| --- | --- |
| APIs e logout simultâneos por processo | 32 solicitações em andamento |
| Rotas de autenticação por processo | Rajada de 30; reposição de 120 por minuto |
| Renovação/consulta de conta por processo | Rajada de 80; reposição de 600 por minuto |
| Tentativas de login, conclusão e confirmação de senha | Orçamento conjunto de 120 por janela de 60 segundos no PostgreSQL, persistente após reinicialização |
| Corpo JSON | 4 KiB para autenticação, exclusão e pesquisa; 8 KiB para preferências; 16 KiB para listas; 32 KiB para IA |
| Recebimento do corpo | Prazo absoluto de 8 segundos |
| Cabeçalhos/conexão | Até 16 KiB; até 100 campos processados; até 100 requisições por conexão |

Um excesso recebe `429`; a barreira anterior ao banco também informa `Retry-After`. Os limites por Gmail, envio de e-mail e fila de scrypt continuam ativos. Os orçamentos agregados também podem recusar picos legítimos; não são proteção completa contra DDoS na rede ou na hospedagem.

As mutações com corpo exigem um objeto `application/json` UTF-8, sem compressão. Corpo excessivo retorna `413`, formato incompatível `415`, envio lento `408` e JSON inválido `400`, com mensagens fixas que não repetem dados privados. Uploads rejeitados por tamanho/prazo são encerrados.

## Proteções mantidas e reforçadas

- Senhas com scrypt e salt próprio; tokens de sessão de 256 bits, somente hash no banco; cookies `HttpOnly`, `Secure`, `SameSite=Lax` e `__Host-` em HTTPS.
- Origem e CSRF exigidos inclusive no login. Tokens de e-mail de uso único. Logout, recuperação e exclusão revogam as sessões correspondentes.
- Consultas por dono autenticado, com testes de isolamento para histórico, empresas, listas, notas e preferências; dados cifrados com AES-256-GCM; conexão externa ao banco com certificado TLS validado.
- CSP em páginas, APIs e erros: scripts locais, eventos inline bloqueados, formulários restritos à própria origem e proibição de frames. CORP `same-origin`, `nosniff`, ausência de referrer e HSTS na hospedagem HTTPS. CSS inline continua permitido porque faz parte da interface atual.
- Arquivos estáticos por lista explícita: fontes do servidor, `.env`, cache e esquema SQL não são servidos. APIs privadas permanecem `no-store`.
- Verificação de sites permite apenas IPv4 público, valida DNS, fixa o endereço na conexão e revalida redirecionamentos. Testes cobrem redes internas, metadata, DNS misto e redirecionamento interno. Nenhuma varredura de terceiros foi feita.

## Validação desta revisão

- `npm test` com PostgreSQL 17 local descartável: **166 testes aprovados, zero ignorados**. Inclui HTTP real para uploads grandes/lentos, limites anteriores à consulta de sessão e orçamento persistente com Gmail/cookies diferentes.
- `python test/security-browser.py`: seis casos em Chromium, computador e celular, usando respostas reais do servidor local retidas durante a revogação da sessão; histórico e cartões continuam vazios e outra conta entra com CSRF renovado.
- `python test/prospects-browser.py`: dois casos em Chromium, persistência de listas, notas, filtros, texto HTML literal, isolamento e expiração.
- Comparação local entre os analisadores anterior e atual: 1.000 entradas controladas, sem mudança nos indicadores de correspondência comercial.
- `npm audit --omit=dev`: nenhuma vulnerabilidade conhecida reportada em 2026-10-05. Isso não demonstra ausência de falhas desconhecidas.

Os testes usam somente contas e empresas de teste; e-mail e buscas externas são proibidos no servidor de fixtures. Não constituem prova de descoberta de empresas, entrega de mensagens ou ausência de invasões em produção. O servidor de fixtures e suas rotas `/__test/` não são carregados pelo `npm start` e não pertencem à lista de arquivos públicos.

## Credenciais e limites da revisão

Credenciais compartilhadas em conversas ou imagens precisam ser substituídas no provedor e atualizadas no ambiente privado do Render. Não repita seus valores em código, documentação ou mensagens. A senha do banco compartilhada anteriormente é uma pendência operacional: esta revisão de código não a rotaciona. Trocar a senha de conexão não exige trocar `DATA_ENCRYPTION_KEY`; alterar essa chave sem migração tornaria os registros e índices existentes inacessíveis.

Esta revisão não incluiu inspeção de todos os privilégios da conta Neon, configuração de MFA dos provedores, backups/restauração ou um pentest externo completo. O código limita requisições e reduz riscos reproduzidos; não oferece garantia de invulnerabilidade.
