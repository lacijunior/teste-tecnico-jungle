export interface PublishMessageParams {
  /** Logical destination for the message (e.g. an SQS queue URL) — adapter-specific addressing. */
  destination: string;
  /** Groups messages that must be delivered in order relative to one another. */
  partitionKey: string;
  /** Identifies this exact delivery attempt so a retried publish is not applied twice. */
  deduplicationKey: string;
  body: string;
}

export interface MessagePublisher {
  publish(params: PublishMessageParams): Promise<void>;
}

export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');
