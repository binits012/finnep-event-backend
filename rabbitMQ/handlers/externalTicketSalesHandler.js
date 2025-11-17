import { inboxModel } from '../../model/inboxMessage.js';
import * as ExternalTicketSales from '../../model/externalTicketSales.js';
import { error, info } from '../../model/logger.js';

export const handleExternalTicketSalesMessage = async (message) => {
    info('Processing external ticket sales message', {
        messageType: typeof message,
        messageKeys: message ? Object.keys(message) : [],
        type: message?.type,
        routingKey: message?.routingKey,
        eventType: message?.eventType,
        fullMessage: message
    });

    // Validate message structure
    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object: %s', { message });
        throw new Error('Message must be an object');
    }

    const messageId = message?.metaData?.causationId || message?.messageId || message?.data?.messageId;

    // Check if message has already been processed (idempotency)
    if (messageId) {
        const isProcessed = await ExternalTicketSales.checkMessageProcessed(messageId);
        if (isProcessed) {
            info(`Message ${messageId} already processed, skipping...`);
            return;
        }
    }

    // Try to save message to inbox, but handle duplicate key error gracefully
    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.eventType || message.type || message.routingKey,
            aggregateId: message.aggregateId || message.data?.eventId,
            data: message,
            metadata: message?.metaData || message?.metadata || { receivedAt: new Date() }
        });
    } catch (saveError) {
        // If it's a duplicate key error, check if the message was already processed
        if (saveError.code === 11000 && messageId) {
            const isAlreadyProcessed = await ExternalTicketSales.checkMessageProcessed(messageId);
            if (isAlreadyProcessed) {
                info(`Message ${messageId} already processed, skipping...`);
                return;
            }
        }
        // Re-throw if it's not a duplicate key error or message wasn't processed
        throw saveError;
    }

    try {
        // Handle different message types
        const messageType = message.eventType || message.type || message.routingKey;

        if (!messageType) {
            error('Message type is missing');
            throw new Error('Message type is required');
        }

        // Extract sale data from message
        const saleData = message.data || message;

        // Validate required fields
        if (!saleData.externalEventId && !saleData.eventId) {
            throw new Error('externalEventId or eventId is required');
        }
        if (!saleData.externalMerchantId && !saleData.merchantId) {
            throw new Error('externalMerchantId or merchantId is required');
        }
        if (!saleData.ticketType) {
            throw new Error('ticketType is required');
        }
        if (saleData.quantity === undefined || saleData.quantity === null) {
            throw new Error('quantity is required');
        }
        if (saleData.unitPrice === undefined || saleData.unitPrice === null) {
            throw new Error('unitPrice is required');
        }

        // Determine source from message type or explicit source field
        let source = saleData.source;
        if (!source) {
            if (messageType.includes('door') || messageType.includes('door_sale')) {
                source = 'door_sale';
            } else if (messageType.includes('partner')) {
                source = 'other'; // Map partner to 'other' to match schema enum
            } else if (messageType.includes('box_office')) {
                source = 'other'; // Map box_office to 'other' to match schema enum
            } else {
                source = 'other';
            }
        } else {
            // Normalize source value to match schema enum: ['door_sale', 'other']
            if (source === 'partner' || source === 'box_office') {
                source = 'other';
            } else if (source !== 'door_sale' && source !== 'other') {
                // If source is not one of the allowed values, default to 'other'
                source = 'other';
            }
        }

        // Prepare sale data for saving
        const externalSaleData = {
            externalEventId: saleData.externalEventId || saleData.eventId,
            externalMerchantId: saleData.externalMerchantId || saleData.merchantId,
            ticketType: saleData.ticketType,
            quantity: Number(saleData.quantity),
            unitPrice: Number(saleData.unitPrice),
            saleDate: saleData.saleDate ? new Date(saleData.saleDate) : new Date(),
            source: source,
            paymentMethod: saleData.paymentMethod || null,
            currency: saleData.currency || 'EUR',
            messageId: messageId
        };

        // Save external ticket sale (with idempotency check)
        const savedSale = await ExternalTicketSales.saveExternalTicketSale(externalSaleData);
        if (savedSale) {
            info(`External ticket sale saved successfully for event ${externalSaleData.externalEventId}, messageId: ${messageId}`);
        } else {
            info(`External ticket sale skipped (duplicate messageId: ${messageId}) for event ${externalSaleData.externalEventId}`);
        }

    } catch (err) {
        error('Error handling external ticket sales message: %s', err.stack);
        throw err;
    }
};

