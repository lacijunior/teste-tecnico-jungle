# Distributed Wagering Processor

Serviço financeiro distribuído para processamento de transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) vindas de múltiplos provedores, com idempotência persistente, concorrência segura por wallet, mensageria confiável (inbox/outbox + SQS), ledger de partidas dobradas e autenticação via OIDC.

Stack: Bun 1.x, TypeScript estrito, NestJS, PostgreSQL, MikroORM, AWS SQS (via LocalStack), Keycloak, Docker Compose.

## Pré-requisitos

- [Bun](https://bun.sh) 1.x
- Docker e Docker Compose

## Setup

```bash
bun install
docker compose up -d postgres localstack keycloak
bun run migration:up
```

As filas SQS (`wager-transactions.fifo`, `wager-transactions-dlq.fifo`, `wagering-domain-events.fifo`, `wagering-domain-events-dlq.fifo`) são criadas automaticamente pelo script de inicialização do LocalStack (`scripts/localstack-init/create-queues.sh`) na primeira subida do container. O realm `wagering` e o client `wagering-provider` do Keycloak são importados automaticamente de `scripts/keycloak-init/wagering-realm.json` na primeira subida.

Copie `.env.example` para `.env` e ajuste se necessário (os valores padrão já funcionam com o `docker-compose.yml`).

## Rodando a aplicação

```bash
bun run start        # produção
bun run start:dev    # com watch
```

A API sobe em `http://localhost:3000` por padrão (`PORT`).

Também é possível rodar tudo via Docker Compose (Postgres + LocalStack + Keycloak + app):

```bash
docker compose up --build
```

## Autenticação

Todos os endpoints exigem um Bearer token OIDC válido, exceto `/health/live` e `/health/ready` — os únicos isentos pela seção 2 do desafio original. `/metrics` carrega contadores de negócio e segue a mesma autenticação dos demais. Para obter um token de teste (client `wagering-provider`, grant `client_credentials`) com o Keycloak já rodando:

```bash
curl -s -X POST "http://localhost:8080/realms/wagering/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=wagering-provider&client_secret=wagering-provider-secret" \
  | bun -e "const chunks=[];for await(const c of Bun.stdin.stream())chunks.push(c);console.log(JSON.parse(Buffer.concat(chunks).toString()).access_token)"
```

(Usa `bun -e` para extrair `access_token` do JSON em vez de `jq`, que não é um pré-requisito do projeto — troque pelo `jq -r .access_token` de sua preferência se já tiver `jq` instalado.)

Use o token retornado no header `Authorization: Bearer <token>` das chamadas à API. O secret acima é um valor de desenvolvimento local, importado só no realm de dev — nunca use em produção.

> O comando acima obtém o token pela porta do host (`localhost:8080`), e o `issuer` do token carrega esse mesmo host. Isso funciona contra `bun run start`/`start:dev` (API também rodando no host). Contra a API subida via `docker compose up --build` (rede interna do compose, `AUTH_ISSUER_URL=http://keycloak:8080/realms/wagering`), um token obtido por `localhost:8080` é rejeitado com `401` por divergência de `issuer` — ver "Riscos conhecidos e limitações" em ARCHITECTURE.md. Para testar a API containerizada, obtenha o token de dentro da rede do compose (a imagem não tem `curl`, mas tem `wget`):
>
> ```bash
> docker compose exec app wget -qO- \
>   --header="Content-Type: application/x-www-form-urlencoded" \
>   --post-data="grant_type=client_credentials&client_id=wagering-provider&client_secret=wagering-provider-secret" \
>   http://keycloak:8080/realms/wagering/protocol/openid-connect/token
> ```

## Testes

```bash
bun run test               # unidade (sem dependências externas)
bun run test:integration   # integração (Postgres, LocalStack e Keycloak reais, via docker compose)
bun run test:concurrency   # cenários de concorrência real (múltiplas instâncias/transações paralelas)
bun run test:all           # tudo junto
bun run test:load          # teste de carga contra uma instância já rodando
```

Os testes de integração e concorrência esperam Postgres em `localhost:5432` (banco `wagering_test`, já criado e migrado separadamente do banco de desenvolvimento `wagering`), LocalStack em `localhost:4566` e Keycloak em `localhost:8080`. Para criar o banco de teste:

```bash
docker compose exec postgres psql -U wagering -d wagering -c "CREATE DATABASE wagering_test;"
DATABASE_URL=postgresql://wagering:wagering@localhost:5432/wagering_test bun run migration:up
```

`bun run test:load` espera a aplicação já rodando (`bun run start` ou `docker compose up app`) em `http://localhost:3000` (configurável via `LOAD_TEST_BASE_URL`); gera wallets, dispara BETs concorrentes e imprime um relatório com throughput, p50/p95/p99, taxa de erro, conflitos de optimistic lock e outbox lag.

## Migrations

```bash
bun run migration:create   # gera uma nova migration a partir do diff das entidades
bun run migration:up
bun run migration:down
```

> As foreign keys do schema são mantidas manualmente nas migrations (não via relação do MikroORM — ver ARCHITECTURE.md). Revisar sempre o conteúdo de uma migration gerada por `migration:create` antes de aplicá-la: o diff automático tende a sugerir removê-las.

## Lint e build

```bash
bun run lint
bun run format:check
bun run build
```

## Principais endpoints

| Método/Caminho | Descrição | Autenticação |
|---|---|---|
| `POST /wallets` | Cria uma wallet (saldo inicial opcional, gera transação interna `OPENING`) | Bearer token |
| `GET /wallets/:walletId` | Consulta wallet | Bearer token |
| `GET /wallets/:walletId/ledger?cursor=&limit=` | Ledger paginado | Bearer token |
| `POST /wallets/:walletId/reconciliation` | Reconciliação saldo × ledger | Bearer token |
| `POST /wagering/transactions` | Submete uma transação (`Idempotency-Key` obrigatório) | Bearer token |
| `GET /wagering/transactions/:transactionId` | Consulta transação por id interno | Bearer token |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta transação por id do provedor | Bearer token |
| `GET /health/live` / `GET /health/ready` | Health checks | Pública |
| `GET /metrics` | Métricas Prometheus | Bearer token |
