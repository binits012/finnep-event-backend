import { v4 as uuidv4 } from 'uuid';
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js';
import { createOutboxMessage, markMessageAsSent, markMessageAsFailed } from '../model/outboxMessage.js';
import { error, info } from '../model/logger.js';

/**
 * Publish discount_code.redeemed to EMS after successful payment (async, idempotent).
 */
export async function publishDiscountCodeRedeemed({
  externalMerchantId,
  externalEventId,
  discountCodeId,
  paymentReference,
  email,
  discountAmount
}) {
  if (!externalMerchantId || !externalEventId || !discountCodeId || !paymentReference) {
    return;
  }

  const correlationId = uuidv4();
  const messageId = uuidv4();
  const messageBody = {
    eventType: 'DiscountCodeRedeemed',
    aggregateId: String(externalEventId),
    data: {
      merchant_id: String(externalMerchantId),
      event_id: String(externalEventId),
      discount_code_id: String(discountCodeId),
      payment_reference: String(paymentReference),
      email: email || null,
      discount_amount: Number(discountAmount) || 0
    },
    metadata: {
      correlationId,
      causationId: messageId,
      timestamp: new Date().toISOString(),
      version: 1,
      source: 'finnep-eventapp-backend'
    }
  };

  const outboxMessageData = {
    messageId,
    exchange: 'event-merchant-exchange',
    routingKey: 'discount_code.redeemed',
    messageBody,
    headers: {
      'content-type': 'application/json',
      'message-type': 'DiscountCodeRedeemed',
      'correlation-id': correlationId
    },
    correlationId,
    eventType: 'DiscountCodeRedeemed',
    aggregateId: String(externalEventId),
    status: 'pending',
    maxRetries: 3,
    attempts: 0
  };

  try {
    const outboxMessage = await createOutboxMessage(outboxMessageData);
    await messageConsumer.publishToExchange(
      outboxMessageData.exchange,
      outboxMessageData.routingKey,
      outboxMessageData.messageBody,
      {
        exchangeType: 'topic',
        publishOptions: {
          correlationId,
          contentType: 'application/json',
          persistent: true,
          headers: outboxMessageData.headers
        }
      }
    );
    await markMessageAsSent(outboxMessage._id);
    info('[publishDiscountCodeRedeemed] published', { paymentReference, discountCodeId });
  } catch (err) {
    error('[publishDiscountCodeRedeemed] failed', err);
    try {
      const outboxMessage = await createOutboxMessage(outboxMessageData);
      await markMessageAsFailed(outboxMessage._id, err.message);
    } catch (_) {
      // best effort
    }
  }
}
