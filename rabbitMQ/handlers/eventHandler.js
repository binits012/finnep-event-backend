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
    await inboxModel.saveMessage({
        messageId: message?.metaData?.causationId,
        eventType: message.type || message.routingKey,
        aggregateId: message.merchantId,
        data: message,
        metadata: message?.metaData || { receivedAt: new Date() }
    });
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
    const eventName = message.id;
    const videoUrl = message?.video_url;
    const otherInfo = message?.other_info;
    const eventTimezone = message?.event_timezone;
    const city = message?.city;
    const country = message?.country;
    const venueInfo = message?.venue_info; 
    const externalEventId = message?.id;
    
    await Event.createEvent(
        eventTitle, eventDescription, eventDate, occupancy,
        ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
        eventLocationGeoCode, transportLink, socialMedia, lang, position,
        active, eventName, videoUrl, otherInfo, eventTimezone,
        city, country, venueInfo, externalMerchantId, merchant, externalEventId
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
    const eventName = message.id;
    const videoUrl = message?.video_url;
    const otherInfo = message?.other_info;
    const eventTimezone = message?.event_timezone;
    const city = message?.city;
    const country = message?.country;
    const venueInfo = message?.venue_info; 
    const externalEventId = message?.id;
    const existingEvent = await Event.getEventByExternalEventId(externalEventId);
    if (!existingEvent) {
        throw new Error(`Event with ID ${externalEventId} not found`);
    }
    await Event.updateEventById(existingEvent._id,{ 
        eventTitle, eventDescription, eventDate, occupancy,
        ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
        eventLocationGeoCode, transportLink, socialMedia, lang, position,
        active, eventName, videoUrl, otherInfo, eventTimezone,
        city, country, venueInfo}
    );
    await inboxModel.markProcessed(message?.metaData?.causationId); 
}

 

async function handleEventDeleted(message) {
    console.log('Updating event:', message);
    const externalMerchantId = message.merchantId;
    const merchant = await getMerchantByMerchantId(externalMerchantId)
    if (!merchant) {
        throw new Error(`Merchant with ID ${externalMerchantId} not found`);
    }
    const externalEventId = message?.id;
    const existingEvent = await Event.getEventByExternalEventId(externalEventId);
    if (!existingEvent) {
        throw new Error(`Event with ID ${externalEventId} not found`);
    }
    await Event.deleteEventById(existingEvent._id);
    await inboxModel.markProcessed(message?.metaData?.causationId); 
}

export { handleEventCreated, handleEventUpdated, handleEventDeleted };
