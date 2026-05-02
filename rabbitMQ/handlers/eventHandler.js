import { inboxModel } from '../../model/inboxMessage.js';
import * as Event from '../../model/event.js';
import { getMerchantByMerchantId } from '../../model/merchant.js';
import { EventManifest } from '../../model/mongoModel.js';
import { error, info, warn } from '../../model/logger.js';
import { pricingManifestSyncService } from '../../src/services/pricingManifestSyncService.js';
import { sendPricingSyncErrorEmail } from '../../util/sendMail.js';
import moment from 'moment-timezone';

function deriveEventEndOfDay({ eventDate, eventTimezone }) {
    const tz = eventTimezone || process.env.TIME_ZONE || 'Europe/Helsinki';
    return moment(eventDate).tz(tz).endOf('day').toDate();
}

function resolveEventEndDate({ message, existingEvent }) {
    const rawEnd = message?.event_end_date;
    if (rawEnd) return new Date(rawEnd);

    // Preserve existing DB value when the broker message doesn't include it.
    if (existingEvent?.event_end_date) return existingEvent.event_end_date;

    // Fallback: derive from event_date end-of-day.
    if (message?.event_date) {
        return deriveEventEndOfDay({ eventDate: message.event_date, eventTimezone: message?.event_timezone });
    }

    // Let caller decide how to handle (schema is required, so ideally this shouldn't happen).
    return undefined;
}

function resolveIsSeatedEvent({ message, existingEvent, venue }) {
    if (typeof message?.is_seated_event === 'boolean') return message.is_seated_event;
    if (typeof existingEvent?.isSeatedEvent === 'boolean') return existingEvent.isSeatedEvent;
    if (typeof message?.hasSeatSelection === 'boolean') return message.hasSeatSelection;
    if (typeof message?.venue?.hasSeatSelection === 'boolean') return message.venue.hasSeatSelection;
    if (typeof venue?.hasSeatSelection === 'boolean') return venue.hasSeatSelection;
    if (typeof existingEvent?.venue?.hasSeatSelection === 'boolean') return existingEvent.venue.hasSeatSelection;
    return false;
}

function sanitizeVenuePatchForManifestGuard(venuePatch = {}) {
    if (!venuePatch || typeof venuePatch !== 'object') return venuePatch;
    const sanitized = { ...venuePatch };
    // Manifest linkage fields are owned by FEB backend; never trust inbound EMS event payload for them.
    delete sanitized.lockedManifestId;
    delete sanitized.manifestS3Key;
    return sanitized;
}

function getAreaSoldTotal(areaSoldCounts) {
    if (!areaSoldCounts) return 0;
    if (typeof areaSoldCounts?.values === 'function') {
        let total = 0;
        for (const value of areaSoldCounts.values()) {
            total += Number(value || 0) || 0;
        }
        return total;
    }
    return Object.values(areaSoldCounts).reduce((sum, value) => sum + (Number(value || 0) || 0), 0);
}

async function hasManifestSalesForEvent(eventMongoId) {
    if (!eventMongoId) return false;
    const manifest = await EventManifest.findOne({ eventId: String(eventMongoId) }).lean();
    if (!manifest) return false;
    const soldCount = Array.isArray(manifest?.availability?.sold) ? manifest.availability.sold.length : 0;
    const areaSoldTotal = getAreaSoldTotal(manifest?.availability?.areaSoldCounts);
    return soldCount > 0 || areaSoldTotal > 0;
}

export const handleEventMessage = async (message) => {
    console.log('Processing event message:', {
        routingKey: message?.routingKey,
        type: message?.type,
        id: message?.id,
        merchantId: message?.merchantId
    });
    if (!message || typeof message !== 'object') {
        error('Invalid message format - not an object %s', { message });
        throw new Error('Message must be an object');
    }

    const messageId = message?.metaData?.causationId;
    if (!messageId) {
        error('Event message missing metaData.causationId (required for idempotency)', {
            routingKey: message?.routingKey,
            type: message?.type
        });
        throw new Error('Event message must include metaData.causationId');
    }

    const routingKey = message.routingKey || message.type;
    if (!routingKey || String(routingKey).trim() === '') {
        error('Event message missing routingKey and type', { messageId });
        throw new Error('Event message must include routingKey or type');
    }

    // Check if message has already been processed (idempotency)
    if (await inboxModel.isProcessed(messageId)) {
        console.log(`Message ${messageId} already processed, skipping...`);
        return;
    }

    // Try to save message, but handle duplicate key error gracefully
    try {
        await inboxModel.saveMessage({
            messageId,
            eventType: message.type || routingKey,
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
        switch (routingKey) {
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
                warn('Unknown event routing key — not applying handlers (no synthetic routes)', {
                    routingKey,
                    messageId,
                    merchantId: message?.merchantId
                });
                throw new Error(`Unknown event routing key: ${routingKey}`);
        }
    } catch (err) {
        console.error('Error handling event message:', {
            routingKey,
            type: message?.type,
            id: message?.id,
            merchantId: message?.merchantId,
            error: err?.message,
            stack: err?.stack
        });
        throw err;
    }
};

async function handleEventCreated(message) {
    console.log('[handleEventCreated] Received message', {
        id: message?.id,
        merchantId: message?.merchantId,
        routingKey: message?.routingKey,
        hasSeatSelection: message?.venue?.hasSeatSelection,
        pricingModel: message?.venue?.pricingModel
    });
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
    // Keep as string to avoid JS number precision loss when storing (event-merchant event id can be bigint)
    const externalEventId = message?.id != null ? String(message.id) : undefined;
    // venue from message should contain: venueId, externalVenueId, hasSeatSelection, etc.
    const venue = message?.venue || {};
    const waitlistConfig = message?.waitlist_config ?? undefined;
    const event_end_date = resolveEventEndDate({ message });
    const isSeatedEvent = resolveIsSeatedEvent({ message, venue });

    console.log('[handleEventCreated] Creating event in MongoDB', {
        externalEventId,
        externalMerchantId,
        title: eventTitle
    });

    await Event.createEvent(
        eventTitle, eventDescription, eventDate, occupancy,
        ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
        eventLocationGeoCode, transportLink, socialMedia, lang, position,
        active, eventName, videoUrl, otherInfo, eventTimezone,
        city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue,
        waitlistConfig, event_end_date, isSeatedEvent
    );

    await inboxModel.markProcessed(message?.metaData?.causationId);
    console.log('[handleEventCreated] Successfully created event and marked inbox message processed', {
        externalEventId,
        merchantId: externalMerchantId
    });
}

async function handleEventUpdated(message) {
    console.log('[handleEventUpdated] Received message', {
        id: message?.id,
        merchantId: message?.merchantId,
        routingKey: message?.routingKey
    });
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
    // Keep as string to avoid JS number precision loss (event-merchant event id can be bigint)
    const externalEventId = message?.id != null ? String(message.id) : undefined;
    const existingEvent = await Event.getEventByMerchantAndExternalId(
        externalMerchantId,
        externalEventId
    );
    console.log('[handleEventUpdated] Lookup existing event result', {
        externalEventId,
        found: !!existingEvent
    });

    const manifestHasSales = existingEvent?._id
        ? await hasManifestSalesForEvent(existingEvent._id)
        : false;

    // When venue is explicitly cleared (venueId null/empty or venue null), clear venue in MongoDB
    const venueCleared = message?.venueId == null || message?.venueId === '' || message?.venue === null;
    let venue;
    if (manifestHasSales && existingEvent) {
        // Guardrail: once tickets are sold, keep FEB venue/manifest linkage untouched.
        venue = existingEvent?.venue;
        info(`[handleEventUpdated] Preserving existing venue because manifest has sold seats`, {
            eventId: existingEvent?._id,
            externalEventId
        });
    } else if (venueCleared) {
        venue = null;
    } else if (message?.venue && typeof message.venue === 'object') {
        const safeVenuePatch = sanitizeVenuePatchForManifestGuard(message.venue);
        // Merge venue data from message with existing venue
        venue = {
            ...(existingEvent?.venue || {}),
            ...safeVenuePatch,
        };
    } else {
        venue = existingEvent?.venue;
    }

    // If event doesn't exist, create it instead of throwing error (upsert behavior)
    // This handles cases where update message arrives before create message
    const waitlistConfig = message?.waitlist_config ?? undefined;
    const event_end_date = resolveEventEndDate({ message, existingEvent });
    const isSeatedEvent = resolveIsSeatedEvent({ message, existingEvent, venue });

    if (!existingEvent) {
        console.log(`Event with ID ${externalEventId} not found, creating new event instead`);
        await Event.createEvent(
            eventTitle, eventDescription, eventDate, occupancy,
            ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
            eventLocationGeoCode, transportLink, socialMedia, lang, position,
            active, eventName, videoUrl, otherInfo, eventTimezone,
            city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue,
            waitlistConfig, event_end_date, isSeatedEvent
        );
    } else {
        const updatePayload = {
            eventTitle, eventDescription, eventDate, occupancy,
            ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
            eventLocationGeoCode, transportLink, socialMedia, lang, position,
            active, eventName, videoUrl, otherInfo, eventTimezone,
            city, country, venueInfo, venue,
            waitlistConfig, event_end_date, isSeatedEvent
        };
        // Sync pre-sale waitlist cap so client has it before any join; count comes only from waitlist.status_updated (on each join)
        if (waitlistConfig && typeof waitlistConfig === 'object' && waitlistConfig.pre_sale_cap != null) {
            updatePayload.pre_sale_waitlist_cap = Number(waitlistConfig.pre_sale_cap);
        }
        await Event.updateEventById(existingEvent._id, updatePayload);
    }

    // Handle pricing manifest sync if needed
    // Check if pricing configuration needs to be synced and event has seat selection
    const pricingConfiguration = message?.pricingConfiguration;
    const hasSeatSelection =
        isSeatedEvent === true ||
        message?.hasSeatSelection === true ||
        venue?.hasSeatSelection === true ||
        existingEvent?.venue?.hasSeatSelection === true;
    const pricingModel = venue?.pricingModel || existingEvent?.venue?.pricingModel;

    // Only sync pricing manifest if:
    // 1. hasSeatSelection is true
    // 2. pricingModel is 'pricing_configuration' (not 'ticket_info')
    // 3. pricingConfiguration.needsSync is true
    if (pricingConfiguration?.needsSync === true && hasSeatSelection === true && pricingModel === 'pricing_configuration') {
        try {
            if (manifestHasSales) {
                info(`[handleEventUpdated] Skipping pricing manifest sync because manifest has sold seats`, {
                    eventId: existingEvent?._id,
                    externalEventId
                });
                await inboxModel.markProcessed(message?.metaData?.causationId);
                return;
            }

            info(`[handleEventUpdated] Starting pricing manifest sync for event ${externalEventId}`, {
                eventId: existingEvent?._id,
                pricingConfigurationId: pricingConfiguration.pricingConfigurationId,
                venueId: pricingConfiguration.venueId,
                s3Key: pricingConfiguration.s3Key
            });

            await pricingManifestSyncService.syncPricingManifest(existingEvent._id, externalEventId, {
                s3Key: pricingConfiguration.s3Key,
                venueId: pricingConfiguration.venueId,
                pricingConfigurationId: pricingConfiguration.pricingConfigurationId
            });

            info(`[handleEventUpdated] Pricing manifest sync completed successfully for event ${externalEventId}`);
        } catch (syncError) {
            // Log error and send email notification, but don't fail the event update
            error(`[handleEventUpdated] Error syncing pricing manifest for event ${externalEventId}:`, {
                error: syncError.message,
                stack: syncError.stack,
                eventId: existingEvent?._id,
                pricingConfiguration
            });

            // Send email notification to merchant
            try {
                const merchantEmail = process.env.REPORTING_EMAIL || 'binits09@gmail.com';
                const eventTitle = message?.title || existingEvent?.eventTitle || 'Unknown Event';
                const errorMessage = syncError?.message || String(syncError) || 'Unknown error';

                await sendPricingSyncErrorEmail(
                    merchantEmail,
                    externalEventId,
                    eventTitle,
                    errorMessage
                );
            } catch (emailError) {
                error(`[handleEventUpdated] Failed to send pricing sync error email:`, {
                    error: emailError?.message || String(emailError),
                    stack: emailError?.stack,
                    eventId: externalEventId
                });
            }
        }
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
