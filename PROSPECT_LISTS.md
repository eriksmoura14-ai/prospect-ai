# Listas de prospecção

Após entrar na conta, use **Salvar na lista** nos resultados de uma pesquisa concluída. Escolha uma lista existente ou crie uma. Em **Minhas listas**, você pode criar, renomear e excluir listas, pesquisar nas empresas salvas, filtrar por contato e editar notas.

Os status **Novo**, **Contatado** e **Interessado** descrevem o contato comercial. Eles são separados da classificação de websites e não alteram o agente de IA nem as regras de classificação.

Cada empresa salva contém uma cópia dos dados disponíveis no momento em que foi adicionada. Essa cópia continua disponível quando o histórico da pesquisa expira; não representa uma nova verificação do website. Salvar novamente a mesma empresa na mesma lista não duplica a entrada nem substitui as notas ou o status. A mesma empresa pode aparecer em listas diferentes.

São permitidas até 20 listas por conta, 250 empresas por lista e 1.000 entradas no total, com notas de até 3.000 caracteres. A interface mostra esses limites; eles não alteram a cobertura ou a área das buscas.

## Armazenamento e proteção

O esquema cria `prospect_lists` e `prospect_list_companies` de maneira idempotente, sob o bloqueio de migração já utilizado pelas contas. Não exige novas variáveis de ambiente. O banco PostgreSQL e a chave de criptografia existentes são reutilizados.

Nomes de listas, cópias de empresas e notas/status são cifrados com AES-256-GCM, autenticando conta, lista e entrada como contexto. A deduplicação usa HMAC; a chave pública da empresa não fica em texto aberto no índice. Todas as consultas de dados incluem a conta da sessão. Uma chave estrangeira composta também impede associar uma entrada à lista de outro usuário.

As operações de criação e alteração usam um bloqueio por conta para manter os limites corretos mesmo com pedidos simultâneos. Há proteção de origem/CSRF e limite de alterações por conta. A API só aceita empresas presentes nos resultados da própria conta, obtendo a cópia no servidor; dados de empresa fornecidos pelo navegador não substituem a fonte.

As listas permanecem até serem excluídas. Excluir uma lista remove suas entradas e notas; excluir a conta remove todas as listas em cascata. Dados privados não são colocados em `localStorage`. A interface limpa listas, notas, rascunhos e diálogos ao encerrar a sessão e ignora respostas que cheguem após essa limpeza.

## Validação

`npm test`, com `TEST_DATABASE_URL` apontando apenas para PostgreSQL descartável, exercita isolamento entre contas, CSRF, deduplicação concorrente, criptografia, persistência, limites, retenção e exclusão. Sem essa variável, a integração do banco permanece ignorada e não comprova persistência.

O teste `test/prospects-browser.py` usa Chromium, o servidor Node.js real e PostgreSQL local descartável. As empresas e contas são fixtures controladas; não há envio de e-mails nem consultas reais ao provedor de empresas. Ele valida interface, persistência das notas após recarregar, troca de conta e limpeza da sessão. Não serve como evidência de descoberta ou entrega de e-mails em produção.
