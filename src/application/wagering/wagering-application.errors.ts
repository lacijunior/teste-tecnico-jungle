export class IdempotencyPayloadConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`idempotency key ${idempotencyKey} was already used with a different payload`);
  }
}

export class ExternalTransactionIdempotencyMismatchError extends Error {
  constructor(providerId: string, externalTransactionId: string) {
    super(
      `provider ${providerId} external transaction ${externalTransactionId} was already recorded under a different idempotency key`,
    );
  }
}

export class WalletNotFoundError extends Error {
  constructor(walletId: string) {
    super(`wallet ${walletId} was not found`);
  }
}

export class WalletOwnershipMismatchError extends Error {
  constructor(walletId: string, playerId: string) {
    super(`wallet ${walletId} does not belong to player ${playerId}`);
  }
}
