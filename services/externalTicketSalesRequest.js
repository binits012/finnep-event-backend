import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js';
import { v4 as uuidv4 } from 'uuid';
import { info, error } from '../model/logger.js';
import { createOutboxMessage, markMessageAsSent, markMessageAsFailed } from '../model/outboxMessage.js';

/**
 * Request external ticket sales data for an event from the external microservice
 * @param {string} externalEventId - The external event ID
 * @param {string} externalMerchantId - The external merchant ID
 * @returns {Promise<void>}
 */
export const requestExternalTicketSales = async (externalEventId, externalMerchantId) => {
    try {
        info(`Requesting external ticket sales data for event ${externalEventId}, merchant ${externalMerchantId}`);

        // Generate unique identifiers for the request
        const correlationId = uuidv4();
        const messageId = uuidv4();

        // Create request message
        const requestData = {
            eventType: 'TicketSalesDataRequest',
            aggregateId: externalEventId,
            data: {
                eventId: externalEventId,
                merchantId: externalMerchantId,
                requestedAt: new Date().toISOString()
            },
            metadata: {
                correlationId: correlationId,
                causationId: messageId,
                timestamp: new Date().toISOString(),
                version: 1,
                source: 'finnep-eventapp-backend'
            }
        };

        // Create outbox message entry for reliability
        const outboxMessageData = {
            messageId: messageId,
            exchange: 'event-merchant-exchange',
            routingKey: 'external.ticket.sales.request',
            messageBody: requestData,
            headers: {
                'content-type': 'application/json',
                'message-type': 'TicketSalesDataRequest',
                'correlation-id': correlationId,
                'event-version': '1.0'
            },
            correlationId: correlationId,
            eventType: 'TicketSalesDataRequest',
            aggregateId: externalEventId,
            status: 'pending',
            exchangeType: 'topic',
            maxRetries: 3,
            attempts: 0
        };

        // Save outbox message for reliability
        const outboxMessage = await createOutboxMessage(outboxMessageData);
        info('Outbox message created for ticket sales data request:', outboxMessage._id);

        // Publish to RabbitMQ exchange
        await messageConsumer.publishToExchange(
            outboxMessageData.exchange,
            outboxMessageData.routingKey,
            outboxMessageData.messageBody,
            {
                exchangeType: 'topic',
                publishOptions: {
                    correlationId: outboxMessageData.correlationId,
                    contentType: 'application/json',
                    persistent: true,
                    headers: outboxMessageData.headers
                }
            }
        ).then(async () => {
            info('Ticket sales data request published successfully:', outboxMessageData.messageId);
            // Mark outbox message as sent
            await markMessageAsSent(outboxMessage._id);
        }).catch(async (publishError) => {
            error('Error publishing ticket sales data request:', publishError);
            // Mark outbox message as failed for retry
            await markMessageAsFailed(outboxMessage._id, publishError.message);
            throw publishError;
        });

        info(`Published ticket sales data request to exchange: ${outboxMessageData.exchange}`);
        return { messageId, correlationId };

    } catch (err) {
        error('Failed to request external ticket sales data:', err);
        throw err;
    }
};

