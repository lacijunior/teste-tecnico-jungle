import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction.js';
import {
  DoubleEntryPosting,
  SameAccountPostingError,
} from '../../../src/domain/ledger/double-entry-posting.js';
import { LedgerAccountType } from '../../../src/domain/ledger/ledger-account.js';

describe('DoubleEntryPosting', () => {
  it('debits the player wallet and credits the provider settlement on a wallet DEBIT movement', () => {
    const posting = DoubleEntryPosting.forWalletMovement({
      id: 'posting-1',
      transactionId: 'tx-1',
      walletId: 'wallet-1',
      providerId: 'provider-a',
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    expect(posting.debitAccount).toEqual({
      type: LedgerAccountType.PlayerWallet,
      referenceId: 'wallet-1',
    });
    expect(posting.creditAccount).toEqual({
      type: LedgerAccountType.ProviderSettlement,
      referenceId: 'provider-a',
    });
  });

  it('debits the provider settlement and credits the player wallet on a wallet CREDIT movement', () => {
    const posting = DoubleEntryPosting.forWalletMovement({
      id: 'posting-1',
      transactionId: 'tx-1',
      walletId: 'wallet-1',
      providerId: 'provider-a',
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    expect(posting.debitAccount).toEqual({
      type: LedgerAccountType.ProviderSettlement,
      referenceId: 'provider-a',
    });
    expect(posting.creditAccount).toEqual({
      type: LedgerAccountType.PlayerWallet,
      referenceId: 'wallet-1',
    });
  });

  it('refuses to post a transaction that debits and credits the exact same account', () => {
    expect(() =>
      DoubleEntryPosting.create({
        id: 'posting-1',
        transactionId: 'tx-1',
        debitAccount: { type: LedgerAccountType.PlayerWallet, referenceId: 'wallet-1' },
        creditAccount: { type: LedgerAccountType.PlayerWallet, referenceId: 'wallet-1' },
        money: Money.from({ amount: '25.00', currency: 'BRL' }),
        createdAt: new Date(),
      }),
    ).toThrow(SameAccountPostingError);
  });
});
