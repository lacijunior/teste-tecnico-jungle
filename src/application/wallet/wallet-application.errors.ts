export class WalletAlreadyExistsError extends Error {
  constructor(playerId: string, currency: string) {
    super(`a wallet for player ${playerId} in ${currency} already exists`);
  }
}

export class InvalidLedgerCursorError extends Error {
  constructor(cursor: string) {
    super(`ledger cursor is not valid: ${cursor}`);
  }
}
