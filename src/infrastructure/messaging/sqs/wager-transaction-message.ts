import {
  EXTERNALLY_SUBMITTABLE_KINDS,
  type WagerTransactionKind,
} from '../../../domain/wagering/wager-transaction-kind.js';

export interface WagerTransactionRequestedData {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionRequestedMessage {
  messageId: string;
  type: string;
  occurredAt: string;
  data: WagerTransactionRequestedData;
}

const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof WagerTransactionRequestedData> = [
  'providerId',
  'externalTransactionId',
  'idempotencyKey',
  'playerId',
  'walletId',
  'roundId',
  'gameId',
];

export function isWagerTransactionRequestedMessage(
  value: unknown,
): value is WagerTransactionRequestedMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.messageId !== 'string' || typeof candidate.type !== 'string') {
    return false;
  }
  return isWagerTransactionRequestedData(candidate.data);
}

function isWagerTransactionRequestedData(value: unknown): value is WagerTransactionRequestedData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const data = value as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof data[field] !== 'string' || data[field] === '') {
      return false;
    }
  }

  if (!EXTERNALLY_SUBMITTABLE_KINDS.includes(data.kind as WagerTransactionKind)) {
    return false;
  }

  if (!isMoneyPayload(data.money)) {
    return false;
  }

  if (
    data.referenceExternalTransactionId !== undefined &&
    typeof data.referenceExternalTransactionId !== 'string'
  ) {
    return false;
  }

  return true;
}

function isMoneyPayload(value: unknown): value is { amount: string; currency: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const money = value as Record<string, unknown>;
  return typeof money.amount === 'string' && typeof money.currency === 'string';
}
