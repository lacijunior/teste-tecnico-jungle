import { Migration } from '@mikro-orm/migrations';

export class Migration20261011173815 extends Migration {
  public override async up(): Promise<void> {
    this.addSql(
      `create table "inbox_messages" ("consumer_name" varchar(255) not null, "message_id" varchar(255) not null, "payload_hash" varchar(255) not null, "received_at" timestamptz not null, "processed_at" timestamptz null, constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id"));`,
    );

    this.addSql(
      `create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" varchar(255) not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null default 0, "next_attempt_at" timestamptz null, "published_at" timestamptz null, constraint "outbox_messages_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "outbox_messages_next_attempt_at_index" on "outbox_messages" ("next_attempt_at");`,
    );

    this.addSql(
      `create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" varchar(3) not null, "balance_amount" numeric(19,2) not null, "version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "wallets_pkey" primary key ("id"), constraint wallets_balance_amount_non_negative check (balance_amount >= 0));`,
    );
    this.addSql(`create index "wallets_player_id_index" on "wallets" ("player_id");`);
    this.addSql(
      `alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`,
    );

    this.addSql(
      `create table "wager_transactions" ("id" uuid not null, "provider_id" varchar(255) not null, "external_transaction_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "payload_hash" varchar(255) not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" varchar(255) not null, "game_id" varchar(255) not null, "kind" varchar(255) not null, "money_amount" numeric(19,2) not null, "money_currency" varchar(3) not null, "reference_external_transaction_id" varchar(255) null, "reference_transaction_id" uuid null, "status" varchar(255) not null, "failure_code" varchar(255) null, "processed_at" timestamptz null, "pending_reference_attempts" int not null default 0, "next_reference_attempt_at" timestamptz null, "balance_snapshot_amount" numeric(19,2) null, "created_at" timestamptz not null, constraint "wager_transactions_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "wager_transactions_wallet_id_index" on "wager_transactions" ("wallet_id");`,
    );
    this.addSql(
      `create index "wager_transactions_status_next_reference_attempt_at_index" on "wager_transactions" ("status", "next_reference_attempt_at");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "wager_transactions_reference_transaction_id_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id");`,
    );

    this.addSql(
      `create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(255) not null, "money_amount" numeric(19,2) not null, "money_currency" varchar(3) not null, "balance_before" numeric(19,2) not null, "balance_after" numeric(19,2) not null, "created_at" timestamptz not null, constraint "wallet_ledger_entries_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "wallet_ledger_entries_wallet_id_index" on "wallet_ledger_entries" ("wallet_id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_transaction_id_unique" unique ("wallet_id", "transaction_id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id");`,
    );
    this.addSql(
      `alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_foreign" foreign key ("transaction_id") references "wager_transactions" ("id");`,
    );

    this.addSql(
      `create table "ledger_postings" ("id" uuid not null, "transaction_id" uuid not null, "debit_account_type" varchar(255) not null, "debit_account_reference_id" varchar(255) not null, "credit_account_type" varchar(255) not null, "credit_account_reference_id" varchar(255) not null, "money_amount" numeric(19,2) not null, "money_currency" varchar(3) not null, "created_at" timestamptz not null, constraint "ledger_postings_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "ledger_postings" add constraint "ledger_postings_transaction_id_unique" unique ("transaction_id");`,
    );
    this.addSql(
      `alter table "ledger_postings" add constraint "ledger_postings_transaction_id_foreign" foreign key ("transaction_id") references "wager_transactions" ("id");`,
    );

    this.addSql(`
      create function ledger_rows_block_mutation() returns trigger as $$
      begin
        raise exception '% rows are immutable, attempted % on id %', tg_table_name, tg_op, old.id;
        return null;
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger wallet_ledger_entries_no_update_or_delete
      before update or delete on "wallet_ledger_entries"
      for each row execute function ledger_rows_block_mutation();
    `);
    this.addSql(`
      create trigger ledger_postings_no_update_or_delete
      before update or delete on "ledger_postings"
      for each row execute function ledger_rows_block_mutation();
    `);
  }

  public override async down(): Promise<void> {
    this.addSql(
      `drop trigger if exists "ledger_postings_no_update_or_delete" on "ledger_postings";`,
    );
    this.addSql(
      `drop trigger if exists "wallet_ledger_entries_no_update_or_delete" on "wallet_ledger_entries";`,
    );
    this.addSql(`drop function if exists ledger_rows_block_mutation();`);
    this.addSql(`drop table if exists "ledger_postings" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
  }
}
