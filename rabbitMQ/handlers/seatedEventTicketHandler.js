import { inboxModel } from '../../model/inboxMessage.js';
import { EventManifest, Event } from '../../model/mongoModel.js';
import { error, info } from '../../model/logger.js';

const resolveMessageId = (message, fallbackEventType) => {
    return message?.metadata?.causationId
        || message?.messageId
        || message?.data?.messageId
        || `${fallbackEventType}:${message?.aggregateId || 'unknown'}`;
};

const saveInboxOnce = async (message, fallbackEventType) => {
    const messageId = resolveMessageId(message, fallbackEventType);

    if (messageId) {
        const isProcessed = await inboxModel.isProcessed(messageId);
        if (isProcessed) {
            info(`Message ${messageId} already processed, skipping...`);
            return { skipped: true, messageId };
        }
    }

    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.eventType || message.type || fallbackEventType,
            aggregateId: message.aggregateId || message.data?.externalEventId,
            data: message,
            metadata: message?.metadata || message?.metaData || { receivedAt: new Date() }
        });
    } catch (saveError) {
        if (saveError.code === 11000 && messageId) {
            const isAlreadyProcessed = await inboxModel.isProcessed(messageId);
            if (isAlreadyProcessed) {
                info(`Message ${messageId} already processed, skipping...`);
                return { skipped: true, messageId };
            }
        }
        throw saveError;
    }

    return { skipped: false, messageId };
};

const loadEventManifest = async (externalEventId, externalMerchantId) => {
    const event = await Event.findOne({
        externalEventId: externalEventId,
        externalMerchantId: externalMerchantId
    });

    if (!event) {
        throw new Error(`Event not found for eventId ${externalEventId}, merchantId ${externalMerchantId}`);
    }

    const eventManifest = await EventManifest.findOne({ eventId: event._id });

    if (!eventManifest) {
        throw new Error(`Event manifest not found for event ${externalEventId}`);
    }

    return { event, eventManifest };
};

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

    const inboxResult = await saveInboxOnce(message, 'SeatedEventTicketCreated');
    if (inboxResult.skipped) {
        return;
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

        if (!(await Event.findOne({
            externalEventId: externalEventId,
            externalMerchantId: externalMerchantId,
            active: true
        }))) {
            throw new Error(`Event not found or inactive for eventId ${externalEventId}, merchantId ${externalMerchantId}`);
        }

        const { eventManifest } = await loadEventManifest(externalEventId, externalMerchantId);

        info('Marking seats as sold in event manifest', {
            eventId: externalEventId,
            merchantId: externalMerchantId,
            placeIdsCount: encodedPlaceIds.length,
            placeIds: encodedPlaceIds
        });

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

export const handleSeatedEventTicketCancelled = async (message) => {
    info('Processing seated event ticket cancelled message', {
        messageType: typeof message,
        messageKeys: message ? Object.keys(message) : [],
        fullMessage: message
    });

    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object: %s', { message });
        throw new Error('Message must be an object');
    }

    const inboxResult = await saveInboxOnce(message, 'SeatedEventTicketCancelled');
    if (inboxResult.skipped) {
        return;
    }

    try {
        const { data } = message;
        const { externalEventId, externalMerchantId, encodedPlaceIds } = data;

        if (!externalEventId || !externalMerchantId) {
            throw new Error('Missing required fields: externalEventId or externalMerchantId');
        }

        if (!encodedPlaceIds || !Array.isArray(encodedPlaceIds) || encodedPlaceIds.length === 0) {
            info('No encoded placeIds provided, skipping seat release');
            return;
        }

        const { eventManifest } = await loadEventManifest(externalEventId, externalMerchantId);

        info('Releasing seats from sold list in event manifest', {
            eventId: externalEventId,
            merchantId: externalMerchantId,
            placeIdsCount: encodedPlaceIds.length,
            placeIds: encodedPlaceIds
        });

        const currentSold = eventManifest.availability?.sold || [];
        const soldSet = new Set(currentSold);
        const releaseIds = new Set(encodedPlaceIds);

        let removedCount = 0;
        for (const placeId of releaseIds) {
            if (soldSet.delete(placeId)) {
                removedCount++;
            }
        }

        if (removedCount > 0) {
            eventManifest.availability = {
                sold: Array.from(soldSet)
            };
            await eventManifest.save();

            info('Seats released from sold list in event manifest', {
                eventId: externalEventId,
                merchantId: externalMerchantId,
                removedCount,
                totalSold: soldSet.size
            });
        } else {
            info('No matching sold seats to release', {
                eventId: externalEventId,
                merchantId: externalMerchantId
            });
        }

    } catch (err) {
        error('Error handling seated event ticket cancelled message: %s', err.stack);
        throw err;
    }
};

export const handleSeatedEventTicketMessage = async (message) => {
    const eventType = message?.eventType || message?.type || '';
    if (eventType === 'SeatedEventTicketCancelled') {
        return handleSeatedEventTicketCancelled(message);
    }
    return handleSeatedEventTicketCreated(message);
};
