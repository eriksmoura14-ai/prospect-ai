# Contas por Gmail e senha · v0.6

O cadastro aceita somente `@gmail.com`, confirma o endereço por e-mail e permite criar uma **senha própria do Prospect AI**. Não usa a senha do Gmail nem solicita acesso à caixa de entrada. Pontos, maiúsculas e tags `+` de um mesmo Gmail identificam uma única conta.

## Estado da entrega

O código tem cadastro, login, recuperação, logout, exclusão da conta e histórico por usuário. A ativação em produção exige PostgreSQL e envio de e-mail configurados. Testes com banco local real e transporte de e-mail capturado não comprovam entrega na caixa de entrada ou funcionamento do novo login no Render.

Enquanto `AUTH_MODE` não for configurado, o site conserva a autenticação básica atual. **Adicionar os arquivos não ativa o novo login automaticamente.** Quando `AUTH_MODE=password`, a antiga senha administrativa não permite acessar os dados das contas.

## Configuração gratuita

1. Crie um projeto PostgreSQL no [plano Free do Neon](https://neon.com/pricing). Use um banco exclusivo do Prospect AI e copie a conexão para o ambiente do serviço no Render. O código usa `pg`; mantenha TLS e a validação do certificado. Não use `sslmode=no-verify`. Consulte as cotas e a retenção de backups vigentes no provedor.
2. Crie uma conta no [plano gratuito da Brevo](https://www.brevo.com/pricing/?currency=usd), obtenha aprovação para envio e verifique um remetente. A página consultada informa até 300 e-mails por dia após aprovação. O aplicativo limita solicitações a 150 por dia e três por endereço/hora; não contrate plano pago para esta configuração. Se a conta/remetente não for aprovada, a etapa de confirmação não está pronta.
3. Adicione os valores diretamente em **Environment** do serviço normal `prospect-ai` no Render. Não publique valores no GitHub, mensagens, imagens ou arquivos do projeto.

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL autenticada, de um banco persistente exclusivo da aplicação. |
| `DATA_ENCRYPTION_KEY` | Chave aleatória de **32 bytes, em base64**, para criptografia e índices HMAC. |
| `BREVO_API_KEY` | Chave da API da conta Brevo aprovada para envio. |
| `EMAIL_FROM` | Endereço de um remetente verificado e aceito pela Brevo. |
| `APP_ORIGIN` | URL pública HTTPS exata do site, sem caminhos. No Render, `RENDER_EXTERNAL_URL` também é aceita. |
| `ADMIN_EMAILS` | Opcional: lista de Gmail separados por vírgula com acesso ao diagnóstico de descoberta. As contas precisam ser confirmadas normalmente. |
| `AUTH_MODE` | Defina **`password` por último**, após preparar todos os valores acima. |

Gere `DATA_ENCRYPTION_KEY` com um gerenciador de segredos ou `openssl rand -base64 32` em um terminal privado. Guarde uma cópia segura: sem essa chave, perfis e buscas ficam ilegíveis. Alterá-la sem migrar os dados também invalida os índices de identificação e proteções CSRF. Não reutilize senhas, chaves de provedores ou conexões como chave de criptografia.

O PostgreSQL Free do Render **expira em 30 dias**, por isso não foi escolhido como armazenamento permanente. O Render Free também bloqueia saída SMTP nas portas 25, 465 e 587; a aplicação usa a API HTTPS da Brevo, com prazo de dez segundos, sem SMTP.

As variáveis de Geoapify, LocationIQ e Groq continuam no servidor e não precisam ser copiadas para o navegador. Não remova as configurações atuais de descoberta nem altere a área geográfica para ativar contas.

## Proteções e retenção

- Senhas: scrypt com salt aleatório, `N=131072`, `r=8`, `p=1`. Mínimo 15 caracteres; máximo 128. Uma operação por vez e fila limitada controlam memória. Nenhuma senha é armazenada em texto aberto.
- Sessões: tokens aleatórios de 256 bits; somente SHA-256 no banco. Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, prefixo `__Host-` em HTTPS e validade máxima de sete dias. Até cinco sessões por conta. Logout revoga a sessão; recuperação revoga todas as anteriores.
- Confirmação/recuperação: links de uso único com validade de 30 minutos; token no fragmento da URL, removido pelo navegador. A conta e sua senha só são criadas após a pessoa abrir o link e escolher a senha. Abrir um link com GET não consome o token. Tokens nunca são retornados pela API pública.
- Origem e CSRF são verificados inclusive antes do login. Todas as consultas de dados usam o dono autenticado; conhecer um ID de busca não permite abrir dados de outra conta. Diagnósticos ficam restritos aos administradores configurados.
- E-mail, preferências e resultados privados: AES-256-GCM com IV aleatório e contexto vinculado ao dono/registro. Identificação por HMAC, sem e-mail aberto no índice. Conexões externas ao banco exigem TLS validado.
- Histórico: últimas 20 buscas por conta, por até 30 dias, incluindo empresas encontradas e os resultados das verificações. Registros vencidos deixam de ser acessíveis imediatamente; a limpeza ocorre nas verificações de saúde e nas solicitações de e-mail, no máximo a cada cinco minutos enquanto o serviço estiver ativo.
- A exclusão exige a senha atual e remove perfil, sessões, links, preferências, buscas, listas, empresas salvas e notas da conta. Backups do provedor seguem os próprios prazos. Guarde somente dados necessários; o histórico de conversa do assistente permanece na aba e não é salvo no banco.

As [listas de prospecção](PROSPECT_LISTS.md) usam a mesma conta, PostgreSQL e chave de criptografia. Notas e cópias das empresas ficam cifradas, isoladas por usuário e independentes da expiração do histórico. Não exigem novas variáveis de ambiente.

A [revisão de segurança](SECURITY.md) documenta os limites de requisição, a proteção contra respostas atrasadas após o encerramento da sessão e a análise limitada de HTML externo, com testes em PostgreSQL e navegador reais. Não exige novas configurações.

O esquema está em `db/schema.sql` e é aplicado de maneira idempotente, com transação e trava de migração. Na primeira inicialização, a conexão precisa poder criar as tabelas no banco exclusivo. Não utilize credenciais de um banco com dados de outros projetos. O arquivo não contém comandos para remover tabelas existentes.

## Verificação

`npm test` executa os testes de regressão e de segurança sem depender de serviços públicos. Para exercitar persistência, isolamento, tokens, sessões e exclusão com **PostgreSQL real**, forneça `TEST_DATABASE_URL` apontando apenas para um banco descartável de teste e rode `npm test` novamente. Sem essa variável, o teste de integração do banco é marcado como ignorado; isso não conta como prova de persistência.

O transporte de e-mail dos testes é capturado localmente, de modo explícito. Não envia mensagens reais e não verifica antispam ou aprovação do remetente. A entrega final só pode ser validada com a configuração real e um Gmail de teste autorizado.

Nos logs privados do Render, `EMAIL_DIAGNOSTIC` distingue uma solicitação aceita pela API (HTTP 201) de uma rejeição, timeout ou falha de conexão. Aceitação não comprova entrega ao Gmail. A inicialização hospedada faz uma verificação somente de leitura da conta, do remetente configurado e de até 50 eventos recentes da Brevo; não envia mensagem de teste nem bloqueia login ou health check. O resumo registra apenas estados, contagens e classificações fixas, sem chaves, endereços, dados pessoais da conta ou links de confirmação. Consulte os eventos transacionais da Brevo para confirmar o destino e o estado de uma mensagem específica.

Após ativar no Render, verifique `/health`, faça um cadastro real, abra a confirmação recebida, defina a senha e entre. Faça uma busca, recarregue e abra o histórico. Teste uma segunda conta: ela não deve ver resultados da primeira. Depois valide recuperação e logout. Uma resposta positiva de `/health` comprova disponibilidade do banco, mas não comprova entrega de e-mail, descoberta de empresas ou uso da IA.

### Fontes consultadas

- [Limites do Render Free](https://render.com/docs/free): expiração do banco e portas SMTP bloqueadas.
- [Neon Free](https://neon.com/pricing): opção PostgreSQL persistente, sujeita às cotas do plano.
- [Brevo Free](https://www.brevo.com/pricing/?currency=usd) e [API de e-mail transacional](https://developers.brevo.com/docs/send-a-transactional-email).

### Arquivos da atualização

Novos: `accounts.cjs`, `auth.cjs`, `passwords.cjs`, `email.cjs`, `db/schema.sql`, `account-ui.js`, `account.css`, `privacy.html`, `ACCOUNTS.md`, `test/auth.test.cjs`, `test/accounts.postgres.test.cjs`.

Atualizados: `server.cjs`, `app.js`, `index.html`, `package.json`, `package-lock.json`, `.gitignore`, `test/discovery.test.cjs`.

`agent.cjs`, `niches.cjs`, descoberta, regras de classificação, filtros de localidades e os arquivos da Terra não são alterados por esta atualização.
