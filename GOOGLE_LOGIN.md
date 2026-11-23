# Entrar com Google

O login por Gmail e senha permanece disponível. “Continuar com Google” usa Authorization Code com PKCE, nonce e state de uso único vinculado ao navegador. A troca do código e a conferência do token assinado são feitas no backend. Nenhum access token/refresh token do Google é guardado, e nenhum segredo é enviado à interface. Não há SDK externo no navegador nem relaxamento da CSP: o fluxo usa redirecionamento da aba.

Aceitam-se somente endereços @gmail.com verificados pelo Google, mantendo a política atual do Prospect. Uma conta Gmail já confirmada no Prospect mantém seu ID, senha, listas, preferências e histórico ao usar Google. O identificador Google é indexado por HMAC. Uma identidade Google diferente não pode substituir o vínculo existente. Se o usuário já estiver logado, a reautenticação precisa corresponder à mesma conta.

Contas criadas por Google têm um marcador aleatório que não é uma senha válida; nunca recebem senha padrão. Podem definir senha pela recuperação de e-mail existente. Para excluir uma conta que só usa Google, exige-se uma sessão Google com até cinco minutos, CSRF e a confirmação explícita de exclusão. Contas que já tinham senha continuam exigindo a senha na exclusão.

## Configuração gratuita pelo titular

1. Acesse https://console.cloud.google.com/auth/clients e crie/selecione um projeto para o Prospect. Não habilite serviços pagos ou faturamento.
2. Configure o aplicativo/consentimento Google com nome e contato de suporte. Durante testes, inclua seu Gmail na lista de usuários de teste. Para acesso público, conclua os requisitos de publicação que o Google indicar; o escopo solicitado é somente `openid email`.
3. Crie um cliente OAuth 2.0 do tipo **Aplicativo da Web**.
4. Cadastre exatamente este URI de redirecionamento autorizado: `https://prospect-ai-xi-ecru.vercel.app/api/auth/google/callback`.
5. Se também for oferecer login diretamente pelo endereço Render, cadastre `https://prospect-ai-a90q.onrender.com/api/auth/google/callback`. Não são usados URIs informados livremente pelo navegador: o backend aceita somente as origens já configuradas em APP_ORIGIN e APP_FRONTEND_ORIGIN.
6. Em https://dashboard.render.com/web/srv-daum6egu01pc73891evg/env salve **GOOGLE_CLIENT_ID** e **GOOGLE_CLIENT_SECRET**. Use os campos privados do Render; não coloque segredo no GitHub, frontend, conversa ou URL.
7. Publique a configuração no Render e confira `/api/account`: `googleAvailable: true` indica configuração completa. Sem os dois valores válidos, o botão fica oculto e o login atual continua funcionando.

O titular ainda não havia criado o cliente Google quando esta implementação começou. Código preparado não significa credencial externa criada ou login Google real validado.

## Banco e segurança

Migração incremental em `db/schema.sql`: duas tabelas novas para identidades e fluxos Google e uma coluna de método na sessão. A migração não remove, recria ou regrava contas. Fluxos duram dez minutos, usam payload AES-GCM e são consumidos atomicamente por hash do state e do cookie do navegador. O código/verifier não aparecem em logs ou respostas ao cliente.

A biblioteca oficial `google-auth-library` valida a assinatura RSA e o destinatário. Há validação adicional de issuer, nonce, idade/expiração, azp, sub e e-mail verificado. Somente o endpoint fixo Google recebe a troca de código. Respostas e tempo são limitados; erros não expõem o segredo. O retorno termina em uma origem configurada e remove o código da URL ao redirecionar.

Testes locais usam assinaturas RSA reais e certificados de fixture; testes de integração usam PostgreSQL descartável e um provedor de identidade de fixture. Eles não representam uma autenticação interativa real contra um cliente Google ainda não configurado. Após configurar as credenciais, o titular precisa testar seleção da conta, consentimento, retorno ao domínio público e recuperação do mesmo histórico.
