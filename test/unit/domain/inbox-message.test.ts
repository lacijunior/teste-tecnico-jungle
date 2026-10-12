import { describe, expect, it } from 'bun:test';
import {
  InboxMessage,
  InboxMessageAlreadyProcessedError,
} from '../../../src/domain/messaging/inbox-message.js';

describe('InboxMessage', () => {
  it('starts unprocessed when received', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wagering-consumer',
      payloadHash: 'hash-1',
      receivedAt: new Date(),
    });

    expect(message.isProcessed()).toBe(false);
  });

  it('becomes processed once marked', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wagering-consumer',
      payloadHash: 'hash-1',
      receivedAt: new Date(),
    });

    message.markProcessed(new Date());

    expect(message.isProcessed()).toBe(true);
  });

  it('refuses to be processed twice', () => {
    const message = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wagering-consumer',
      payloadHash: 'hash-1',
      receivedAt: new Date(),
    });
    message.markProcessed(new Date());

    expect(() => message.markProcessed(new Date())).toThrow(InboxMessageAlreadyProcessedError);
  });
});
