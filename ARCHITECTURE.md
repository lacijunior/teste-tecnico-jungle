# Arquitetura

## Visão geral

Clean Architecture com quatro camadas:

```
src/
  domain/          # entidades, value objects, regras de negócio — sem I/O
  application/     # use cases, serviços de aplicação, portas (interfaces)
  infrastructure/  # MikroORM, SQS, workers, auth, observabilidade, config, implementação das portas
  api/http/        # controllers, DTOs, filtro de exceções
```

O domínio (`Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, `DoubleEntryPosting`, `IntegrationEvent`) não depende de ORM, NestJS ou AWS SDK. A aplicação orquestra casos de uso usando os agregados de domínio e portas (`Clock`, `IdGenerator`, `MessagePublisher`, `WageringMetrics`). A infraestrutura implementa essas portas e expõe repositórios MikroORM com métodos nomeados pelo domínio.

Trade-off assumido conscientemente: a persistência **não** tem uma porta própria — os use cases chamam `MikroORM`/`EntityManager`/repositórios MikroORM diretamente, não uma abstração de repositório definida na camada de aplicação. A escolha segue a recomendação da seção 4 do desafio de usar "Unit of Work e Identity Map explícitos, `EntityManager.transactional()`" como peça central da coordenação transacional do use case — introduzir uma porta de repositório por cima disso trocaria uma dependência direta e idiomática do MikroORM por uma camada de indireção que não muda o comportamento, só o acoplamento declarado. É a lacuna mais discutível deste desenho em relação à arquitetura hexagonal estrita; as demais dependências de infraestrutura (relógio, geração de id, publicação de mensagens, métricas) têm porta.

## Decisões principais

### Autenticação — Keycloak via OIDC

Integração com um Identity Provider externo (Keycloak), conforme sugerido pelo desafio original, em vez de autenticação artesanal. Fluxo: `client_credentials` — cada provedor de jogo é um client confidencial do Keycloak com conta de serviço habilitada, autentica-se diretamente com o IdP e recebe um JWT assinado (RS256) para chamar a API.

- `AuthGuard` ([auth.guard.ts](src/infrastructure/auth/auth.guard.ts)) valida a assinatura do JWT contra o JWKS do Keycloak (via `jose`, com cache de chaves) e o `issuer`, registrado globalmente via `APP_GUARD`. Não valida `audience` explicitamente: o realm de dev não configura um Audience Mapper, então todo token de `client_credentials` sai com `aud: "account"` (padrão do Keycloak) independente do client — fixar essa audiência no `jwtVerify` não distinguiria token legítimo de ilegítimo, só repetiria um valor que já é universal no realm. Validar audiência de forma que funcione é uma mudança de configuração do realm (Audience Mapper por client), não só de código — uma limitação conhecida e aceita, consistente com a seção 2 do desafio não pontuar autenticação.
- `@Public()` ([public.decorator.ts](src/infrastructure/auth/public.decorator.ts)) isenta apenas `/health/live` e `/health/ready` — os únicos endpoints que a seção 2 do desafio dispensa de autenticação. `/metrics` carrega contadores de negócio (status de transações, conflitos de lock, outbox lag) e por isso exige o mesmo Bearer token dos demais endpoints; `scripts/load-test.ts` já autentica antes de ler `/metrics`.
- Mensagens SQS são tratadas como canal interno confiável (seção 2 do desafio): a fila não exige token, mas a identidade do provedor contida na mensagem (`providerId`) segue as mesmas validações de domínio que o HTTP.
- `docker-compose.yml` sobe um Keycloak em modo dev (`start-dev --import-realm`) com o realm `wagering` e o client `wagering-provider` importados automaticamente de [scripts/keycloak-init/wagering-realm.json](scripts/keycloak-init/wagering-realm.json). O client secret ali (`wagering-provider-secret`) é um valor de desenvolvimento local, nunca usado em produção, no mesmo espírito das credenciais `test`/`test` do LocalStack.
- Limitação conhecida: o `issuer` de um token depende do host usado para obtê-lo do Keycloak. O fluxo local/testes usa consistentemente `http://localhost:8080/realms/wagering` (host → host); o serviço `app` do `docker-compose.yml` valida contra `http://keycloak:8080/realms/wagering` (rede interna do compose), assumindo que provedores que chamam a API containerizada também obtêm o token pela mesma rede. Resolver isso de forma totalmente transparente exigiria um hostname público estável para o Keycloak (ex.: `KC_HOSTNAME` fixo + proxy reverso), fora do escopo de um ambiente de desenvolvimento local.

### ORM — MikroORM

Escolhido pela Unit of Work e Identity Map explícitos, por `EntityManager.transactional()` dar atomicidade direta entre wallet, ledger, inbox e outbox, e por suportar optimistic locking nativo via `@Property({ version: true })` sem SQL manual.

As entidades de persistência (sufixo `Entity`) são mapeadas por colunas simples (`walletId: string`, não uma relação `@ManyToOne`), para manter os agregados de domínio desacoplados de navegação objeto-a-objeto entre aggregates diferentes — `Wallet`, `WagerTransaction` e `WalletLedgerEntry` são aggregates distintos que se referenciam só por id, nunca por referência de objeto. Isso tem dois custos práticos, ambos assumidos conscientemente:

1. Sem relações declaradas, o MikroORM não calcula ordem de insert por dependência de FK automaticamente. Onde isso importa (ex.: `wallet_ledger_entries` depende de `wager_transactions` e `wallets` já existirem), o código força a ordem com `em.flush()` intermediário antes de inserir a linha dependente.
2. As foreign keys (`wager_transactions.wallet_id`, `wallet_ledger_entries.transaction_id` etc.) foram adicionadas manualmente na migration, não via decorator — por isso elas não entram no diff automático de `migration:create`: uma nova chamada a esse comando vai sugerir removê-las (já que a metadata das entidades não as conhece). A migration gerada deve sempre ser revisada manualmente antes de aplicar; é um trade-off aceito em troca de manter os agregados sem relações objeto-a-objeto. A constraint `CHECK` de saldo não sofre desse problema porque está declarada via `@Check()` na entidade.

### Concorrência — optimistic locking com retry

`Wallet` usa optimistic locking (coluna `version`, gerida nativamente pelo MikroORM — `UPDATE ... WHERE version = ?`, com `OptimisticLockError` quando zero linhas são afetadas). `WalletLockRetryPolicy` ([wallet-lock-retry-policy.ts](src/application/wallet/wallet-lock-retry-policy.ts)) envolve `SubmitWagerTransactionUseCase.execute()` e refaz a transação inteira (recarregando a wallet do zero) em caso de conflito, com backoff curto e limite de tentativas (`WALLET_LOCK_MAX_RETRIES`).

Essa estratégia foi escolhida sobre `SELECT ... FOR UPDATE` (que serializaria toda a wallet) porque a maioria das operações em produção não disputa a mesma wallet simultaneamente — otimista com retry tem custo zero no caminho feliz e só paga o preço de uma releitura quando há conflito real. Trade-off aceito: sob contenção extrema na mesma wallet (muitos workers batendo na mesma linha ao mesmo tempo), os retries aumentam a latência de cauda, e a política pode se esgotar — ver "Falha de infraestrutura" abaixo.

### Falha de infraestrutura: retries esgotados

Quando `WalletLockRetryPolicy` esgota as tentativas (`WalletLockRetryExhaustedError`), `SubmitWagerTransactionUseCase.execute()` não deixa a requisição cair em erro genérico: abre uma nova transação curta, verifica se nesse meio-tempo a mesma `Idempotency-Key` já foi concluída por outra tentativa (nesse caso devolve o replay normalmente) e, senão, persiste a própria `WagerTransaction` como `FAILED` com `failureCode = INFRASTRUCTURE_TRANSIENT_FAILURE` e um snapshot do saldo no momento — um registro auditável de que a tentativa falhou por contenção, não por regra de negócio. A API responde `503`; como a chave de idempotência já existe, o provedor pode reenviar a mesma requisição depois sem duplicar efeito (ver [infrastructure-failure.test.ts](test/integration/wagering/infrastructure-failure.test.ts)).

### Idempotência

- Chave de idempotência: `Idempotency-Key` do header HTTP (ou `data.idempotencyKey` da mensagem SQS) é a fonte da verdade, armazenada com `UNIQUE` em `wager_transactions.idempotency_key`.
- `payloadHash`: SHA-256 sobre um JSON canônico (chaves ordenadas alfabeticamente, sem espaços) do subconjunto de campos de negócio (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId`). Header e metadados de transporte nunca entram no hash. Implementação em [idempotency-key-policy.ts](src/application/wagering/idempotency-key-policy.ts).
- Replay: mesma chave + mesmo `payloadHash` → retorna o resultado original (`idempotentReplay: true`). O `balance` retornado vem de um snapshot exato gravado na própria `WagerTransaction` no momento em que ela atingiu seu status (campo `balanceSnapshotAmount`, preenchido em toda transição — `markProcessed`, `reject`, `fail`, `markPendingReference`) — honra literalmente "o saldo observado naquele momento" para qualquer status, inclusive `LOSS`, `REJECTED` e `PENDING_REFERENCE`, que não geram lançamento no ledger.
- Corrida entre duas submissões concorrentes com a mesma chave: ambas podem passar pela leitura inicial antes de qualquer commit (`READ COMMITTED`). A segunda a tentar inserir recebe uma violação de constraint única do Postgres (`UniqueConstraintViolationException`), que `SubmitWagerTransactionUseCase.execute()` captura e resolve buscando a linha que a vencedora commitou, devolvendo-a como replay — em vez de propagar o erro. Coberto pelo teste de "50 requisições paralelas idênticas" (`test/concurrency/wager-concurrency.test.ts`).
- A mesma recuperação distingue qual constraint única foi violada: se a mesma `idempotencyKey` já existe, é replay (ou conflito de payload, ver acima); se foi `(providerId, externalTransactionId)` que colidiu mas sob uma chave diferente da já registrada, isso nunca é tratado como replay — a chave é a fonte da verdade declarada, então uma chave diferente para a mesma operação externa é um conflito explícito (`ExternalTransactionIdempotencyMismatchError`, `409`), inclusive quando as duas submissões chegam ao mesmo tempo.

### Transactional Outbox

`OutboxMessage` é persistido na mesma transação SQL da mudança financeira. `OutboxPublisherWorker` processa cada lote em três fases, nenhuma delas presa à latência do SQS:

1. **Claim** (`claimBatch`, transação curta): `SELECT ... FOR UPDATE SKIP LOCKED` (SQL bruto, já que o claim precisa pular linhas travadas por outro publisher sem bloquear) reivindica o lote e grava uma lease (`OutboxMessage.claim`, que só adianta `next_attempt_at`, sem contar como tentativa falha) antes de comitar — a transação, e o lock que vinha com ela, fecham imediatamente.
2. **Publish** (fora de qualquer transação): publica as mensagens do lote agrupadas por `aggregateId`. Cada grupo é publicado sequencialmente — na ordem de `occurredAt` que o claim já estabeleceu — e grupos de agregados diferentes rodam em paralelo entre si. Isso preserva a ordem de publicação por wallet (duas mensagens da mesma wallet nunca chegam ao SQS fora da ordem em que foram criadas) sem serializar o lote inteiro: wallets independentes continuam publicando em paralelo. Se uma mensagem falha, as seguintes do mesmo grupo não são tentadas nesse ciclo — publicá-las agora entregaria fora de ordem em relação à que acabou de falhar; a falha e o agendamento do retry (fase 3) afetam todas elas. Uma chamada lenta ou um SQS indisponível nunca mantém uma conexão Postgres nem um lock aberto — o pior caso é só mais tempo sem usar o pool de conexões.
3. **Finalize** (`finalizeBatch`, outra transação curta): busca as mesmas linhas de novo e marca `publishedAt` (sucesso) ou agenda o backoff exponencial via `scheduleRetry` (falha).

Múltiplos publishers (múltiplas instâncias) nunca reivindicam a mesma linha simultaneamente graças ao `SKIP LOCKED` na fase de claim. Se um publisher morre entre o claim e o finalize — o cenário que a fase 2 isola de qualquer transação —, a lease simplesmente expira (`OUTBOX_CLAIM_LEASE_MS`, 30s em produção, 1s nos testes) e a linha volta a ficar disponível para a próxima instância que fizer poll, sem perder nem travar a mensagem; publicar a mesma mensagem duas vezes nessa janela é seguro porque os consumidores já toleram entrega duplicada por design. Isso vale mesmo quando a publicação da primeira instância demora mais que a lease e as duas tentativas terminam de finalizar em paralelo: `finalizeBatch` sempre busca o estado atual da linha antes de decidir, então a segunda finalização a comitar nunca reabre uma linha que a primeira já marcou publicada — testado em [outbox-publisher-worker.test.ts](test/integration/messaging/outbox-publisher-worker.test.ts) (dois processos Nest completos disputando o mesmo lote), [outbox-crash-recovery.test.ts](test/integration/messaging/outbox-crash-recovery.test.ts) (uma instância comita e nunca publica; outra, criada depois, publica no lugar) e [outbox-lease-race.test.ts](test/integration/messaging/outbox-lease-race.test.ts) (publicação deliberadamente mais lenta que a lease, com duas instâncias reais disputando a mesma mensagem) — e a ordem por agregado em [outbox-publish-order.test.ts](test/integration/messaging/outbox-publish-order.test.ts).

Os eventos de integração (`WalletBalanceChanged`, `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference`) são publicados em uma fila própria, `wagering-domain-events.fifo`, separada da fila de entrada `wager-transactions.fifo`. O desafio original não especifica o destino desses eventos; manter entrada e saída na mesma fila misturaria comandos recebidos com eventos publicados por este mesmo serviço, o que violaria responsabilidade única da fila e criaria risco de o próprio consumidor processar seus próprios eventos de saída.

### Ledger de partidas dobradas (double-entry bookkeeping)

Implementado como camada adicional ao ledger de entrada única (`WalletLedgerEntry`, que continua sendo a fonte da verdade para o saldo da wallet — nada nessa decisão muda). Para cada operação que afeta saldo, um `DoubleEntryPosting` ([double-entry-posting.ts](src/domain/ledger/double-entry-posting.ts)) é gravado na mesma transação, com duas pernas: uma conta `PLAYER_WALLET:<walletId>` e uma conta `PROVIDER_SETTLEMENT:<providerId>` (ou `internal` para o crédito de abertura). A direção de cada perna deriva da mesma `LedgerDirection` já calculada para o `WalletLedgerEntry` — débito na wallet é crédito no provedor e vice-versa — nunca há uma terceira fonte de verdade.

Convenção adotada: crédito na conta `PLAYER_WALLET` aumenta o saldo do jogador, débito diminui — ou seja, `créditos − débitos` de uma conta `PLAYER_WALLET` deve sempre igualar o saldo atual da wallet. Essa é exatamente a invariante verificada em [double-entry-ledger.test.ts](test/integration/ledger/double-entry-ledger.test.ts): soma de créditos menos soma de débitos por conta bate com o saldo materializado. `ledger_postings` tem a mesma trigger de imutabilidade do `wallet_ledger_entries` (sem `UPDATE`/`DELETE`, nem por SQL direto).

### Mensageria SQS

`SqsConsumerAdapter` consome `wager-transactions.fifo` reutilizando o mesmo `SubmitWagerTransactionUseCase` da API HTTP. Deduplicação por inbox persistente (`InboxMessage`, chave `(consumerName, messageId)`), inserida na **mesma transação** da lógica de negócio — por isso uma linha de inbox encontrada já processada é sempre uma garantia segura de duplicata (nunca existe um estado "inbox gravado mas transação pendente" observável por outra conexão, pois ambos só se tornam visíveis juntos no commit). `ack` (delete da mensagem) só ocorre depois do commit bem-sucedido. Erro de qualquer natureza na transação → mensagem não é deletada → fica visível de novo após o backoff de visibilidade (`ChangeMessageVisibilityCommand`, exponencial a partir de `ApproximateReceiveCount`) → o limite de tentativas da fila (`maxReceiveCount=5`, configurado no redrive policy em `scripts/localstack-init/create-queues.sh`) move a mensagem para a DLQ automaticamente — a lógica de DLQ é inteiramente do SQS, não reimplementada na aplicação.

As até `POLL_BATCH_SIZE` (5) mensagens de um lote são processadas em paralelo (`Promise.all`): dentro de uma fila FIFO, o SQS nunca entrega duas mensagens não confirmadas do mesmo `MessageGroupId` ao mesmo tempo, então mensagens do mesmo lote pertencem a grupos distintos — processar em paralelo não reordena operações dentro de um grupo, só entre grupos independentes, o que o sistema já tolera por desenho.

Falhas de processamento são contadas separadamente por `wagering_sqs_message_failures_total{kind}`: `permanent` para um envelope que nunca vai se recuperar de um retry (JSON inválido, ou corpo que não casa com o schema esperado — `PermanentMessageError`), `transient` para qualquer outra coisa (conectividade, contenção de lock etc.). As duas seguem o mesmo caminho de `backoffVisibility` e DLQ via `maxReceiveCount` — a aplicação não reimplementa roteamento de DLQ —, mas ficam visíveis separadamente no log e na métrica, para que um operador saiba distinguir uma falha permanente de uma transitória.

`SIGTERM`: `app.enableShutdownHooks()` + `OnModuleDestroy` em cada worker/consumer. O consumidor aborta o long-poll em andamento (`AbortController`) e espera as mensagens em processamento (`Set` de promises in-flight) antes de permitir o encerramento do processo.

### Referências fora de ordem (`PENDING_REFERENCE`)

`PendingReferenceReprocessorWorker` roda em polling (`PENDING_REFERENCE_POLL_INTERVAL_MS`), busca transações `PENDING_REFERENCE` com `nextReferenceAttemptAt` vencido, tenta resolver a referência de novo. Backoff exponencial por tentativa (2s, 4s, 8s... até 5 min), limite de tentativas (`PENDING_REFERENCE_MAX_ATTEMPTS`) ou TTL (`PENDING_REFERENCE_TTL_HOURS`), o que esgotar primeiro — então `REJECTED` com `failureCode = REFERENCE_NOT_FOUND`.

A submissão inicial e o worker de reprocessamento distinguem explicitamente duas situações antes de decidir entre esperar ou rejeitar: a referência pode ainda **não existir** (legítimo esperar — é exatamente o cenário de entrega fora de ordem que `PENDING_REFERENCE` existe para cobrir) ou pode já existir em um **estado terminal diferente de `PROCESSED`** (`REJECTED`/`FAILED` — nunca vai se tornar `PROCESSED`, então esperar só consome tentativas de reprocessamento inutilmente). O segundo caso rejeita imediatamente com `failureCode = REFERENCE_NEVER_PROCESSED`, sem gastar nenhuma tentativa de `PENDING_REFERENCE` — testado em [submit-wager-transaction.test.ts](test/integration/wagering/submit-wager-transaction.test.ts) (referência já `REJECTED` no momento da submissão) e [pending-reference-worker.test.ts](test/integration/wagering/pending-reference-worker.test.ts) (referência chega `REJECTED` enquanto a reversão já está `PENDING_REFERENCE`).

A lógica de validação da referência (`ReferenceResolver.ensureValid`, em [reference-resolver.ts](src/domain/wagering/reference-resolver.ts)) é um serviço de domínio puro, sem I/O — reutilizado tanto pela submissão inicial (`SubmitWagerTransactionUseCase`) quanto pelo worker de reprocessamento, que fazem cada um sua própria busca da transação referenciada e persistência (inserção vs. atualização de uma linha já existente são fluxos diferentes o bastante para não compartilhar a orquestração completa sem introduzir indireção desproporcional ao ganho).

### Taxonomia de `failureCode`

`INSUFFICIENT_FUNDS`, `NEGATIVE_BALANCE_ON_REVERSAL`, `CURRENCY_MISMATCH`, `REFERENCE_NOT_FOUND`, `REFERENCE_NEVER_PROCESSED`, `REFERENCE_ALREADY_REVERSED`, `REFERENCE_TYPE_INVALID`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_AMOUNT_MISMATCH`, `IDEMPOTENCY_PAYLOAD_CONFLICT`, `VALIDATION_ERROR`, `WALLET_NOT_FOUND`, `WALLET_ALREADY_EXISTS`, `INFRASTRUCTURE_TRANSIENT_FAILURE`, `INFRASTRUCTURE_PERMANENT_FAILURE` ([failure-code.ts](src/domain/wagering/failure-code.ts)). `REFERENCE_AMOUNT_MISMATCH` e `REFERENCE_NEVER_PROCESSED` foram adicionados além da lista sugerida no desafio: o primeiro cobre a regra "valor de REFUND/ROLLBACK deve ser igual ao da referência" com um código distinto e estável em vez de colapsá-la em `VALIDATION_ERROR`; o segundo distingue uma referência que nunca vai chegar (estado terminal diferente de `PROCESSED`) de uma que ainda pode chegar (`REFERENCE_NOT_FOUND`, só atribuído após esgotar tentativas/TTL).

### Mapeamento de status HTTP

| Situação | Status |
|---|---|
| Criação nova (wallet ou transação `PROCESSED`) | `201` |
| Replay idempotente de uma transação `PROCESSED` | `200` |
| `PENDING_REFERENCE` (nova submissão ou replay) | `202` |
| Rejeição de regra de negócio (`REJECTED`, nova ou replay) | `422` |
| Conflito de idempotência / wallet duplicada | `409` |
| Payload inválido | `400` |
| Não autenticado / token inválido | `401` |
| Recurso não encontrado | `404` |
| Falha transitória de infraestrutura (retries de lock esgotados, nova ou replay) | `503` |

O desafio não especifica o código de um replay idempotente (seção 9: "o mapeamento é decisão sua"). A decisão aqui é que **o status HTTP reflete o estado atual do recurso, não se esta requisição específica fez algum trabalho novo**: `200` em vez de `201` só faz sentido para distinguir "nada foi criado agora" de uma criação real — e isso só é um fato relevante quando o resultado é `PROCESSED` (sucesso terminal). Para `PENDING_REFERENCE`, `REJECTED` e `FAILED`, o estado em si já é a informação que importa; repetir a mesma chave de idempotência não muda esse estado, então o status HTTP permanece o mesmo com ou sem replay — isso evita a combinação inconsistente de responder `200` (que sugere conclusão) junto de `"status": "PENDING_REFERENCE"` no corpo (que indica processamento ainda em andamento).

### Paginação do ledger

`GET /wallets/:id/ledger` usa cursor opaco (`createdAt|id` em base64url) sobre `ORDER BY createdAt DESC, id DESC`. O filtro do cursor reproduz essa mesma comparação composta: `createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id < cursor.id)`. Lançamentos com o mesmo timestamp (plausível sob escrita concorrente) usam o `id` como critério de desempate, exatamente como a ordenação — garantindo que a página seguinte nunca repita uma linha que já apareceu na anterior. Testado em [wallet-query.test.ts](test/integration/wallet/wallet-query.test.ts) com várias entradas forçadas para o mesmo `createdAt`.

### Decimal — `decimal.js`

`Money` usa `decimal.js` internamente, nunca exposto fora do Value Object (serializa só como `{amount: string, currency: string}`). `amount` em contratos de entrada precisa casar exatamente com `^\d+\.\d{2}$`; esse regex único já rejeita `NaN`, `Infinity`, notação científica, string vazia, mais de 2 casas decimais e negativos, sem checagens adicionais.

## Conformidade com as restrições invioláveis do desafio

| Restrição | Como é atendida |
|---|---|
| Não usar `number`/`float` para dinheiro | `Money` só aceita string decimal, aritmética via `decimal.js` |
| Não usar cache em memória para idempotência | Idempotência via `UNIQUE` em Postgres (`idempotency_key`), sem cache |
| Não confiar só em SQS FIFO | Consistência garantida pelo Postgres (constraints, optimistic lock); FIFO é otimização de ordenação |
| Não publicar evento antes do commit | Outbox: evento só é lido e publicado pelo worker depois do commit da transação de negócio |
| Não sobrescrever/excluir lançamentos do ledger | Sem métodos de transição na entidade de domínio + trigger de banco (`ledger_rows_block_mutation`) bloqueia `UPDATE`/`DELETE` em `wallet_ledger_entries` e `ledger_postings` mesmo via SQL direto |
| Não usar lock global compartilhado | Optimistic lock é por linha de wallet (coluna `version`), não há lock de tabela/global |
| Não fazer `read → calculate → update` sem controle de concorrência | `UPDATE ... WHERE version = ?` nativo do MikroORM, com retry em conflito |
| Correto com múltiplas instâncias | Testado com 4 instâncias Nest/MikroORM separadas no mesmo Postgres (`test/concurrency/multi-instance.test.ts`) |
| Garantias no schema do banco | `CHECK (balance_amount >= 0)`, `UNIQUE` em wallets/idempotency/ledger, FKs, triggers de imutabilidade do ledger — tudo na migration, não só em código |

## Testes

- **Unidade** (`test/unit`): `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, `DoubleEntryPosting`, `ReferenceResolver`, `IdempotencyKeyPolicy`, `WalletLockRetryPolicy`. Sem containers.
- **Integração** (`test/integration`): constraints de schema, atomicidade, idempotência, todas as regras de `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`, worker de referência pendente, outbox (publicação e dois publishers concorrentes), consumidor SQS real (incluindo redelivery), reconciliação, paginação do ledger, ledger de partidas dobradas, falha de infraestrutura (retries esgotados), API HTTP ponta a ponta com autenticação real. Rodam contra Postgres, LocalStack e Keycloak reais via `docker-compose`.
- **Concorrência** (`test/concurrency`): cenário obrigatório da seção 8 (duas apostas de 80 contra saldo de 100), 50 requisições paralelas idênticas, wallets distintas em paralelo, 4 instâncias Nest/MikroORM separadas disputando a mesma wallet.
- **Carga** (`bun run test:load`, [scripts/load-test.ts](scripts/load-test.ts)): dispara BETs concorrentes contra uma instância já rodando (via `docker compose up` ou `bun run start`), mede throughput e p50/p95/p99, categoriza cada amostra (sucesso, `202` pendente de referência, `422` rejeição de negócio, `409` conflito, outro `4xx` de cliente, `5xx`/falha de rede como falha de infraestrutura) e reporta cada contagem separadamente, e lê conflitos de optimistic lock e outbox lag do `/metrics`, imprimindo um relatório em Markdown. Sem meta de RPS — o objetivo é observar o comportamento sob carga real, não maximizar um número.

Os testes de integração/concorrência usam `AppWithoutBackgroundJobsModule` ([app-without-background-jobs.module.ts](src/app-without-background-jobs.module.ts)) por padrão — a mesma aplicação, sem o consumidor SQS e os workers de outbox/referência pendente iniciando automaticamente — para não sobrecarregar o LocalStack/Postgres com dezenas de loops de polling simultâneos entre arquivos de teste. Os testes que exercitam especificamente o consumidor ou os workers usam `createFullTestApp()`, que sobe a `AppModule` completa (a mesma usada em produção). Ambas aplicam o `AuthGuard` globalmente, assim como em produção.

## Riscos conhecidos e limitações

- **`testcontainers`**: os testes de integração assumem Postgres, LocalStack e Keycloak já rodando via `docker compose up -d postgres localstack keycloak` (e um banco `wagering_test` criado e migrado à parte — ver README), em vez de subir containers efêmeros por execução via uma lib de testcontainers. Não foi validada compatibilidade de bibliotecas de testcontainers com o runtime Bun; manter os containers de longa duração via compose é a alternativa usada aqui.
- **Issuer do Keycloak em container vs. host**: ver seção "Autenticação" acima.
- **FKs fora do diff automático de migration**: ver seção "ORM — MikroORM" acima.
