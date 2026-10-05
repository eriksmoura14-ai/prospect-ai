# Agente comercial do Prospect AI

O agente usa a Groq configurada no servidor para revisar evidências e preparar mensagens. A melhoria de 2026-10-05 acrescenta instruções de atendimento e exemplos fictícios no contexto do modelo. Não há contratação de treinamento ou novo provedor. O conteúdo fornecido em cada solicitação não é uma atualização dos pesos do modelo.

## Configurar a própria oferta

Abra **Assistente de IA** em uma empresa dos seus resultados:

1. Informe seu nome e a oferta real, com escopo, preço, moeda e prazo quando estiverem definidos.
2. Escolha **Natural** ou **Profissional** em **Tom da conversa**.
3. Preencha **Informações de atendimento** com até 1.800 caracteres: itens incluídos, manutenção, condições de pagamento, descontos autorizados e respostas frequentes.
4. Cole somente o histórico efetivamente enviado/recebido e a nova resposta do cliente. Use **Sugerir resposta** e revise antes de copiar.

O nome, oferta, idioma, tom e informações de atendimento ficam salvos cifrados na conta. Cada usuário tem sua configuração; outra conta não acessa esse perfil. Contas existentes recebem tom Natural e informações vazias até editar. No modo básico, essas preferências permanecem no navegador. Conversas e rascunhos continuam apenas nesta aba.

Os dados preenchidos são enviados à Groq ao usar a IA, conforme o aviso do painel. Não inclua dados pessoais sensíveis nas informações de atendimento ou na conversa. Os testes não usaram conversas reais de usuários.

## Comportamento orientado

- Responder primeiro ao que o cliente perguntou; evitar reapresentação e fazer no máximo uma pergunta útil.
- Usar condições da oferta ou das informações de atendimento; não inventar preço, desconto, prazo, agenda ou garantias.
- Não tratar valores do rascunho anterior nem propostas do cliente como condições autorizadas pelo vendedor. Se a oferta e as informações adicionais se contradisserem, pedir confirmação.
- Reconhecer objeções sem pressão e respeitar clientes que já têm site ou fornecedor, sem inventar problemas.
- Distinguir interesse específico de recusa: “não quero site, só um logo” pode ser interesse. Um pedido para parar exige encerramento breve, sem nova oferta.
- Preservar a diferença entre fatos do OpenStreetMap, verificações do site e incertezas. Informações do vendedor não são evidência sobre a empresa prospectada.

Os exemplos demonstram comportamento para serviços distintos, não fornecem preços ou condições para o cliente atual. A auditoria continua usando evidências da empresa, sem os exemplos comerciais. Descoberta, classificação de empresas, área geográfica, limites de segurança e revisão humana permanecem ativos. O aplicativo não envia os rascunhos aos clientes.

## Validação

`npm test` com PostgreSQL 17 descartável: **178 testes aprovados, zero ignorados**. Os testes do transporte do agente usam respostas identificadas como fixtures e verificam validação, separação de papéis, perfil, erros do provedor e proteção de chaves; não comprovam a qualidade de uma resposta real da IA.

`python test/agent-profile-browser.py`, usando `test/prospects-browser-server.cjs`: Chromium em computador e celular confirmou persistência do perfil após recarregar, isolamento entre contas, texto HTML literal, inclusão do perfil na solicitação e remoção do painel após expirar a sessão. O servidor local proíbe chamadas a provedores.

### Avaliar o modelo real

Com `GROQ_API_KEY` disponível apenas no ambiente privado do servidor:

```sh
npm run eval:agent -- --limit=3
```

Há 12 casos fictícios; `--limit=12` executa todos. A avaliação usa o mesmo modelo e instruções do aplicativo, sem e-mail ou busca de empresas. Os três primeiros casos testam preço não informado, preço falso no rascunho anterior e pedido para parar. Não há repetição automática após falha ou cota esgotada. As chamadas consomem a cota atual da Groq; não foi contratado plano pago.

Para diagnóstico temporário no Render, a variável opcional `AGENT_EVALUATION_RUN` aceita um identificador de 8–80 caracteres (`a-z`, `A-Z`, dígitos ou hífen). Ela habilita somente os três primeiros casos na inicialização hospedada. O PostgreSQL limita o mesmo identificador/revisão a uma execução por 24 horas. A avaliação é desativada por padrão; deixe a variável vazia após registrar os resultados. Não existe rota pública que habilite a avaliação.

Os logs `AGENT_EVALUATION` registram somente os casos fictícios, respostas, revisão do prompt, modelo e critérios automáticos. Nenhuma chave é registrada. `checks_passed`, `checks_failed` e `incomplete` distinguem os resultados. O relatório de um gerador simulado indica `fixture-generator-not-provider-evidence` e não pode ser utilizado como prova do modelo real.

Critérios automáticos detectam alguns erros e limites de texto. Tom, pertinência, língua e condições precisam também de leitura humana; três respostas aprovadas não garantem comportamento correto em todos os casos. A IA pode errar, e mensagens reais continuam exigindo revisão antes do envio.

Na primeira avaliação real, a leitura humana encontrou itens de pacote não informados e convite futuro após recusa, apesar de os critérios iniciais passarem. Na segunda, o encerramento melhorou, mas uma pergunta ainda pediu várias informações e o pacote foi chamado de "completo" sem esse escopo estar definido. A revisão `2026-10-05.3` reforça esses limites e a concisão. As respostas dessas rodadas foram preservadas como registros de regressão: os novos critérios rejeitam os problemas identificados. Reproduzir registros capturados não é uma nova chamada ao modelo; cada avaliação real é identificada nos logs por revisão e horário.

## Arquivos

`agent.cjs`, `agent-guidance.cjs`, `agent-evaluation.cjs`, `app.js` e `server.cjs` implementam as instruções, perfil, interface e avaliação opcional. `package.json` acrescenta o comando de avaliação. Os testes estão em `test/agent.test.cjs`, `test/agent-evaluation.test.cjs`, `test/accounts.postgres.test.cjs` e `test/agent-profile-browser.py`.
