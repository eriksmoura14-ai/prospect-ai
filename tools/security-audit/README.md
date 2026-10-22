# Skill de autenticação corrigida para o Prospect AI

Pacote de desenvolvimento baseado no catálogo comunitário indicado, com atribuição em
[NOTICE.md](NOTICE.md) e licença Apache-2.0 preservada. A revisão original foi
testada primeiro; esta cópia corrige os problemas reproduzidos.

## Correções

- Respostas 401 são comparadas; um HTTP 4xx não equivale a ausência de resposta.
- Acesso anônimo usa uma sessão independente da conta autenticada.
- Rotas públicas e privadas são declaradas; um HTTP 200 em `/api/account` público
  não vira alerta de invasão. Rota ausente, redirecionamento, HTML inesperado,
  erro de rede, HTTP 5xx e limite de consultas produzem resultado inconclusivo.
- Logout só é avaliado depois de confirmar acesso autenticado e sucesso no POST.
  A verificação reapresenta o cookie original, mesmo quando o navegador o remove.
- Contas de teste e campo de login são configuráveis; a comparação ignora IDs
  variáveis de requisição e examina as mensagens de rejeição da API.
- `generate_report` executa os testes de enumeração e logout quando configurados.
  Testes omitidos ficam registrados; JWT pode ser declarado não aplicável a cookies.
- Relatórios não incluem credenciais, cookies, CSRF, conteúdo privado de resposta,
  payload JWT ou chave de assinatura encontrada. As chaves comuns são testadas
  apenas offline contra um token explicitamente fornecido.

## Requisitos

Node 22+, Python 3.10+ e as dependências fixadas em `requirements.txt`.
Na raiz do repositório:

```bash
python -m venv .artifacts/audit-venv
.artifacts/audit-venv/bin/python -m pip install -r tools/security-audit/requirements.txt
.artifacts/audit-venv/bin/python -m unittest discover -s tools/security-audit -p test_agent.py -v
```

O comando acima executa os controles sintéticos em loopback, incluindo a falha
que a versão original não detectou e o alerta de logout incorreto.

## Adaptador do Prospect

O adaptador usa a autenticação e o PostgreSQL reais do projeto por meio do
servidor de fixtures. Trabalha apenas com esse servidor em `127.0.0.1`; não usa
contas, chaves ou e-mails de produção. O servidor de fixtures bloqueia buscas
externas e envio de e-mail.

1. Prepare um PostgreSQL descartável local, autenticado, com banco exclusivo
   cujo nome comece com `prospect_audit_`.
2. Em arquivo privado fora do repositório, configure `TEST_DATABASE_URL` para
   esse banco. Não use o banco Neon de produção.
3. Exporte as variáveis do arquivo privado sem imprimir os valores e execute
   na raiz do Prospect:

```bash
SECURITY_AUDIT_PYTHON=.artifacts/audit-venv/bin/python npm run audit:auth
```

O adaptador cria sessões de duas contas de fixture e confere acesso anônimo,
isolamento entre contas, arquivos privados, CSRF, formato e atributos do cookie,
enumeração por mensagem e revogação após logout. As contas são preparadas pelo
servidor de fixtures; o adaptador não envia links de cadastro. O comando executa
os controles sintéticos, inicia o servidor local e o encerra mesmo se a auditoria
falhar. A porta 3161 precisa estar livre. Destrua o banco descartável ao concluir.

O workflow `.github/workflows/security-audit.yml` executa as regressões do projeto
e a auditoria em cada pull request e push na `main`, com PostgreSQL efêmero,
permissão de leitura e sem segredos do repositório. Não executa varreduras em
produção nem consultas a empresas. Um resultado inconclusivo falha o comando.
O workflow detecta regressões; bloquear merges exige configurar uma regra de
proteção da branch separadamente.

## Uso genérico do helper

```bash
.artifacts/audit-venv/bin/python tools/security-audit/testing-api-authentication-weaknesses/scripts/agent.py \
  http://127.0.0.1:3161 --public-path /health --public-path /api/account \
  --protected-path /api/history --protected-path /api/lists
```

Esse comando genérico executa somente as rotas declaradas. Sem contas e fluxo de
sessão configurados, o relatório é incompleto, com código de saída 2. Para o
fluxo completo de cookies do Prospect, utilize `npm run audit:auth`.

O helper aceita `--token-env NOME_DA_VARIAVEL` para inspecionar um JWT fornecido
em ambiente privado. Não passe tokens como texto de argumentos. A presença de
`alg=none` ou de um TTL longo é uma observação sobre o token; não prova aceitação
pelo servidor. Os relatórios não representam certificação de segurança.

## Códigos de saída

- `0`: verificações configuradas concluídas sem achados.
- `1`: achado confirmado no escopo do teste ou checagem do adaptador falhou.
- `2`: cobertura incompleta ou resultado inconclusivo.

Artefatos do comando: `.artifacts/security-audit/api_auth_report.json` e
`.artifacts/security-audit/prospect_auth_report.json`.
São gravados com permissões restritas. O código instalado no site não é modificado
por estes testes. O pacote não foi enviado ao repositório comunitário. Ele fica
fora da lista pública do backend e da compilação da interface.
