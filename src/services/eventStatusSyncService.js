import { v4 as uuidv4 } from 'uuid';
import { OutboxMessage } from '../../model/mongoModel.js';
import { createOutboxMessagesBatch } from '../../model/outboxMessage.js';
import { messageConsumer } from '../../rabbitMQ/services/messageConsumer.js';
import { error, info } from '../../model/logger.js';

const EXCHANGE = 'event-merchant-exchange';
const ROUTING_KEY = 'external.event.status.updated';

/**
 * Build a single outbox payload for event active/lifecycle status sync to EMS.
 */
export function buildEventStatusOutboxMessage({
  event,
  before = {},
  after = {},
  eventType,
  updatedBy = 'system',
  updatedAt = new Date(),
}) {
  const correlationId = uuidv4();
  const messageId = uuidv4();
  const aggregateId = event?._id?.toString?.() || String(event?._id || '');

  return {
    messageId,
    exchange: EXCHANGE,
    routingKey: ROUTING_KEY,
    messageBody: {
      eventType,
      aggregateId,
      data: {
        merchantId: event.externalMerchantId,
        eventId: event.externalEventId,
        before: {
          active: before.active,
          status: before.status,
        },
        after: {
          active: after.active,
          status: after.status,
        },
        updatedBy,
        updatedAt,
      },
      metadata: {
        correlationId,
        causationId: messageId,
        timestamp: new Date().toISOString(),
        version: 1,
      },
    },
    headers: {
      'content-type': 'application/json',
      'message-type': eventType,
      'correlation-id': correlationId,
    },
    correlationId,
    eventType,
    aggregateId,
    status: 'pending',
    attempts: 0,
    maxRetries: 3,
    createdAt: new Date(),
    exchangeType: 'topic',
  };
}

/**
 * Persist outbox rows and publish immediately. Failed publishes leave pending rows for retry.
 */
export async function publishEventStatusUpdates(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { saved: [], published: 0, failed: 0 };
  }

  const valid = messages.filter((msg) => {
    if (!msg?.messageBody?.data?.merchantId) {
      error('Skipping status outbox message: missing merchantId', {
        aggregateId: msg?.aggregateId,
      });
      return false;
    }
    return true;
  });

  if (valid.length === 0) {
    return { saved: [], published: 0, failed: 0 };
  }

  const saved = await createOutboxMessagesBatch(valid);
  info(`Wrote ${saved.length} event status outbox messages`);

  let published = 0;
  let failed = 0;

  try {
    await messageConsumer.ensureChannelsReady();
  } catch (err) {
    error('Failed to ensure RabbitMQ channels for status sync; leaving messages pending', err);
    return { saved, published: 0, failed: saved.length };
  }

  for (const msg of valid) {
    try {
      await messageConsumer.publishToExchange(
        msg.exchange,
        msg.routingKey,
        msg.messageBody,
        {
          exchangeType: 'topic',
          durable: true,
          publishOptions: {
            correlationId: msg.correlationId,
            contentType: 'application/json',
            persistent: true,
            headers: msg.headers,
            ...(msg.messageId ? { messageId: msg.messageId } : {}),
          },
        }
      );

      const savedDoc = saved.find((s) => s.messageId === msg.messageId);
      if (savedDoc?._id) {
        await OutboxMessage.updateOne(
          { _id: savedDoc._id },
          { $set: { status: 'sent', sentAt: new Date(), processedAt: new Date() } }
        );
      }
      published += 1;
    } catch (err) {
      failed += 1;
      error(`Failed to publish event status message ${msg.messageId}`, err);
    }
  }

  return { saved, published, failed };
}

/**
 * Convenience: sync one event's active + lifecycle status to EMS.
 */
export async function syncEventStatusToEms({
  event,
  before,
  after,
  updatedBy = 'system',
}) {
  if (!event?.externalMerchantId || event?.externalEventId == null) {
    error('Cannot sync event status: missing external ids', {
      id: event?._id,
      externalMerchantId: event?.externalMerchantId,
      externalEventId: event?.externalEventId,
    });
    return null;
  }

  const active = after.active === true;
  const eventType = active ? 'EventActivated' : 'EventDeactivated';
  const message = buildEventStatusOutboxMessage({
    event,
    before,
    after,
    eventType,
    updatedBy,
  });

  return publishEventStatusUpdates([message]);
}
