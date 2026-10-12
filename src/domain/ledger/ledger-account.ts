export enum LedgerAccountType {
  PlayerWallet = 'PLAYER_WALLET',
  ProviderSettlement = 'PROVIDER_SETTLEMENT',
}

export interface LedgerAccountRef {
  type: LedgerAccountType;
  referenceId: string;
}

export function sameAccount(a: LedgerAccountRef, b: LedgerAccountRef): boolean {
  return a.type === b.type && a.referenceId === b.referenceId;
}
