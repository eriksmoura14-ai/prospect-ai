# Prospect AI 0.8

A descoberta agora relaciona os resultados ao serviço vendido: sites, redes sociais,
design, anúncios ou automação. Cada empresa apresenta uma hipótese de oportunidade,
um rascunho de primeira abordagem e uma estratégia com próximos passos. A estratégia
pode ser aprofundada no agente existente com o identificador da pesquisa e da empresa.
Nada é enviado automaticamente ao contato.

A prioridade usa somente a evidência disponível: contato publicado, divergências e,
para sites, ausência de site identificado na consulta. Isso não representa intenção
de compra. Necessidade, qualidade de redes sociais, orçamento e avaliações não são
inventados. Os dados, fontes e critérios anteriores continuam disponíveis nos cartões.

As listas aceitam Novo, Contatado, Respondeu, Interessado, Proposta enviada, Fechado e
Sem interesse. A visualização em funil organiza os mesmos registros e notas; o status
continua sendo atualizado com Salvar alterações. Os registros antigos são compatíveis.
Os dados permanecem nas estruturas criptografadas existentes, sem migração SQL.

## Verificação

- `npm test`: regras de oportunidade, compatibilidade dos status, contratos de segurança
  e a suíte existente. O teste de integração Postgres exige TEST_DATABASE_URL local.
- `npm run build:frontend`: publica apenas a lista explícita de recursos públicos.
- `node test/build-ui-preview.cjs`: build exclusivo de QA com empresas fictícias,
  respostas locais e todas as operações externas bloqueadas. Usar somente em um
  deployment de preview; o build normal nunca inclui qa-preview.html/js ou qa-mobile.html.
