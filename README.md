# prospect-ai

Prospect AI 0.7: busca OpenStreetMap / QLever integrada ao projeto com contas,
listas, histórico, verificação de sites e assistente Groq.

- Executar: `npm ci` e `npm start` (Node.js 22 ou superior).
- Testar: `npm test`.
- Build da interface: `npm run build:frontend`.
- Integração e ativação no backend: [QLEVER_DISCOVERY.md](QLEVER_DISCOVERY.md).


## Motor global opcional (homologação)

A auditoria está em [GLOBAL_DISCOVERY_AUDIT.md](GLOBAL_DISCOVERY_AUDIT.md). Veja [configuração e operação](GLOBAL_DISCOVERY.md) e [métricas reais e limitações](GLOBAL_DISCOVERY_BENCHMARK.md). O motor global é desativado por padrão; esta branch não migra nem publica a produção.
