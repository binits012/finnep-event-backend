import { inboxModel } from '../../model/inboxMessage.js';
import * as Event from '../../model/event.js';
import { getMerchantByMerchantId } from '../../model/merchant.js';
import { error } from '../../model/logger.js';

export const handleEventMessage = async (message) => {
    console.log('Processing event message:', message);
    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object %s', { message });
        throw new Error('Message must be an object');
    }

    const messageId = message?.metaData?.causationId;

    // Check if message has already been processed (idempotency)
    if (messageId && await inboxModel.isProcessed(messageId)) {
        console.log(`Message ${messageId} already processed, skipping...`);
        return;
    }

    // Try to save message, but handle duplicate key error gracefully
    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.type || message.routingKey,
            aggregateId: message.merchantId,
            data: message,
            metadata: message?.metaData || { receivedAt: new Date() }
        });
    } catch (saveError) {
        // If it's a duplicate key error, check if the message was already processed
        if (saveError.code === 11000 && messageId) {
            const isAlreadyProcessed = await inboxModel.isProcessed(messageId);
            if (isAlreadyProcessed) {
                console.log(`Message ${messageId} already processed, skipping...`);
                return;
            }
        }
        // Re-throw if it's not a duplicate key error or message wasn't processed
        throw saveError;
    }

    try {
        switch (message.routingKey) {
            case 'event.created':
                await handleEventCreated(message);
                break;
            case 'event.updated':
                await handleEventUpdated(message);
                break;
            case 'event.deleted':
                await handleEventDeleted(message);
                break;
            default:
                console.log(`Unknown event message type: ${message.type}`);
        }
    } catch (error) {
        console.error('Error handling event message:', error);
        throw error;
    }
};

async function handleEventCreated(message) {
    console.log(message, 'creating event:');
    const externalMerchantId = message.merchantId;
    const merchant = await getMerchantByMerchantId(externalMerchantId)
    if (!merchant) {
        throw new Error(`Merchant with ID ${externalMerchantId} not found`);
    }

    const eventTitle = message?.title
    const eventDescription = message?.description;
    const eventDate = message?.event_date;
    const occupancy = message?.occupancy;
    const ticketInfo = message?.ticket_info
    const eventPromotionPhoto = message?.promotion_photo;
    const eventPhoto = message?.event_photo;
    const eventLocationAddress = message?.location_address;
    const eventLocationGeoCode = message?.location_geo_code;
    const transportLink = message?.transport_link;
    const socialMedia = message?.social_media;
    const lang = message?.lang;
    const position = message?.position;
    const active = message?.active;
    const eventName =externalMerchantId+'_'+ message.id;
    const videoUrl = message?.video_url;
    // Build enhanced otherInfo with additional fields
    const otherInfo = {
        ...(message?.other_info || {}),
        categoryName: message?.category_name,
        subCategoryName: message?.subcategory_name,
        eventExtraInfo: {
            eventType: message?.event_type,
            doorSaleAllowed: message?.door_sale_allowed,
            doorSaleExtraAmount: message?.door_sale_extra_amount
        }
    };
    const eventTimezone = message?.event_timezone;
    const city = message?.city;
    const country = message?.country;
    const venueInfo = message?.venue_info;
    const externalEventId = message?.id;
    const venue = message?.venue;

    await Event.createEvent(
        eventTitle, eventDescription, eventDate, occupancy,
        ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
        eventLocationGeoCode, transportLink, socialMedia, lang, position,
        active, eventName, videoUrl, otherInfo, eventTimezone,
        city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue
    );

    await inboxModel.markProcessed(message?.metaData?.causationId);
}

async function handleEventUpdated(message) {
    console.log('Updating event:', message);
    const externalMerchantId = message.merchantId;
    const merchant = await getMerchantByMerchantId(externalMerchantId)
    if (!merchant) {
        throw new Error(`Merchant with ID ${externalMerchantId} not found`);
    }

    const eventTitle = message?.title
    const eventDescription = message?.description;
    const eventDate = message?.event_date;
    const occupancy = message?.occupancy;
    const ticketInfo = message?.ticket_info
    const eventPromotionPhoto = message?.promotion_photo;
    const eventPhoto = message?.event_photo;
    const eventLocationAddress = message?.location_address;
    const eventLocationGeoCode = message?.location_geo_code;
    const transportLink = message?.transport_link;
    const socialMedia = message?.social_media;
    const lang = message?.lang;
    const position = message?.position;
    const active = message?.active;
    const eventName =externalMerchantId+'_'+ message.id;
    const videoUrl = message?.video_url;
    // Build enhanced otherInfo with additional fields
    const otherInfo = {
        ...(message?.other_info || {}),
        categoryName: message?.category_name,
        subCategoryName: message?.subcategory_name,
        eventExtraInfo: {
            eventType: message?.event_type,
            doorSaleAllowed: message?.door_sale_allowed,
            doorSaleExtraAmount: message?.door_sale_extra_amount
        }
    };
    const eventTimezone = message?.event_timezone;
    const city = message?.city;
    const country = message?.country;
    const venueInfo = message?.venue_info;
    const externalEventId = message?.id;
    const existingEvent = await Event.getEventByMerchantAndExternalId(externalMerchantId,
        externalEventId);
    const venue = existingEvent?.venue || message?.venue;

    // If event doesn't exist, create it instead of throwing error (upsert behavior)
    // This handles cases where update message arrives before create message
    if (!existingEvent) {
        console.log(`Event with ID ${externalEventId} not found, creating new event instead`);
        await Event.createEvent(
            eventTitle, eventDescription, eventDate, occupancy,
            ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
            eventLocationGeoCode, transportLink, socialMedia, lang, position,
            active, eventName, videoUrl, otherInfo, eventTimezone,
            city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue
        );
    } else {
        await Event.updateEventById(existingEvent._id,{
            eventTitle, eventDescription, eventDate, occupancy,
            ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
            eventLocationGeoCode, transportLink, socialMedia, lang, position,
            active, eventName, videoUrl, otherInfo, eventTimezone,
            city, country, venueInfo, venue}
        );
    }
    await inboxModel.markProcessed(message?.metaData?.causationId);
}



async function handleEventDeleted(message) {
    console.log('Deleting event:', message);
    const externalMerchantId = message.merchantId;
    const merchant = await getMerchantByMerchantId(externalMerchantId)
    if (!merchant) {
        throw new Error(`Merchant with ID ${externalMerchantId} not found`);
    }
    const externalEventId = message?.id;
    const existingEvent = await Event.getEventByMerchantAndExternalId(externalMerchantId, externalEventId);
    // If event doesn't exist, just log and mark as processed (idempotent delete)
    // This handles cases where delete message arrives after event was already deleted
    if (!existingEvent) {
        console.log(`Event with ID ${externalEventId} not found, already deleted or never existed`);
        await inboxModel.markProcessed(message?.metaData?.causationId);
        return;
    }
    await Event.deleteEventById(existingEvent._id);
    await inboxModel.markProcessed(message?.metaData?.causationId);
}

export { handleEventCreated, handleEventUpdated, handleEventDeleted };
