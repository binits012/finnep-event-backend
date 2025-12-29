import { inboxModel } from '../../model/inboxMessage.js';
import { EventManifest, Event } from '../../model/mongoModel.js';
import { error, info } from '../../model/logger.js';

export const handleSeatedEventTicketCreated = async (message) => {
    info('Processing seated event ticket created message', {
        messageType: typeof message,
        messageKeys: message ? Object.keys(message) : [],
        fullMessage: message
    });

    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object: %s', { message });
        throw new Error('Message must be an object');
    }

    const messageId = message?.metadata?.causationId || message?.messageId || message?.data?.messageId;

    if (messageId) {
        const isProcessed = await inboxModel.isProcessed(messageId);
        if (isProcessed) {
            info(`Message ${messageId} already processed, skipping...`);
            return;
        }
    }

    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.eventType || message.type || 'SeatedEventTicketCreated',
            aggregateId: message.aggregateId || message.data?.externalEventId,
            data: message,
            metadata: message?.metadata || message?.metaData || { receivedAt: new Date() }
        });
    } catch (saveError) {
        if (saveError.code === 11000 && messageId) {
            const isAlreadyProcessed = await inboxModel.isProcessed(messageId);
            if (isAlreadyProcessed) {
                info(`Message ${messageId} already processed, skipping...`);
                return;
            }
        }
        throw saveError;
    }

    try {
        const { data } = message;
        const { externalEventId, externalMerchantId, encodedPlaceIds } = data;

        if (!externalEventId || !externalMerchantId) {
            throw new Error('Missing required fields: externalEventId or externalMerchantId');
        }

        if (!encodedPlaceIds || !Array.isArray(encodedPlaceIds) || encodedPlaceIds.length === 0) {
            info('No encoded placeIds provided, skipping seat marking');
            return;
        }

        info('Marking seats as sold in event manifest', {
            eventId: externalEventId,
            merchantId: externalMerchantId,
            placeIdsCount: encodedPlaceIds.length,
            placeIds: encodedPlaceIds
        });

        const event = await Event.findOne({
            externalEventId: externalEventId,
            externalMerchantId: externalMerchantId
        });

        if (!event || !event.active) {
            throw new Error(`Event not found or inactive for eventId ${externalEventId}, merchantId ${externalMerchantId}`);
        }

        const eventManifest = await EventManifest.findOne({ eventId: event._id });

        if (!eventManifest) {
            throw new Error(`Event manifest not found for event ${externalEventId}`);
        }

        const currentSold = eventManifest.availability?.sold || [];
        const soldSet = new Set(currentSold);

        let addedCount = 0;
        for (const placeId of encodedPlaceIds) {
            if (!soldSet.has(placeId)) {
                soldSet.add(placeId);
                addedCount++;
            }
        }

        if (addedCount > 0) {
            eventManifest.availability = {
                sold: Array.from(soldSet)
            };
            await eventManifest.save();

            info('Seats marked as sold in event manifest', {
                eventId: externalEventId,
                merchantId: externalMerchantId,
                addedCount: addedCount,
                totalSold: soldSet.size
            });
        } else {
            info('All seats already marked as sold', {
                eventId: externalEventId,
                merchantId: externalMerchantId
            });
        }

    } catch (err) {
        error('Error handling seated event ticket created message: %s', err.stack);
        throw err;
    }
};

