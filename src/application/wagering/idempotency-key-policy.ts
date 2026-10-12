import { createHash } from 'node:crypto';
import type { MoneyProps } from '../../domain/money/money.js';

export interface WagerTransactionPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export class IdempotencyKeyPolicy {
  public static defaultKey(providerId: string, externalTransactionId: string): string {
    return `${providerId}:${externalTransactionId}`;
  }

  public static hashPayload(payload: WagerTransactionPayload): string {
    return createHash('sha256').update(canonicalize(payload)).digest('hex');
  }
}

function canonicalize(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const fields = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
  );
  return `{${fields.join(',')}}`;
}
