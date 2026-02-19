import * as Event from '../../model/event.js';
import { error, info } from '../../model/logger.js';

/**
 * Handle waitlist.status_updated from event-merchant-service (RabbitMQ).
 * Payload: data = { merchant_id, event_id, pre_sale_count, pre_sale_cap }
 * Updates the MongoDB event so getEventById returns count/cap for the client (no HTTP to event-merchant).
 */
export const handleWaitlistStatusUpdated = async (message) => {
    const data = message?.data ?? message;
    const merchantId = data?.merchant_id ?? data?.merchantId;
    const eventId = data?.event_id != null ? String(data.event_id) : (data?.eventId != null ? String(data.eventId) : null);
    const pre_sale_count = data?.pre_sale_count;
    const pre_sale_cap = data?.pre_sale_cap;

    if (merchantId == null || eventId == null) {
        error('[waitlistStatusUpdated] missing merchant_id or event_id', { merchantId, eventId });
        throw new Error('waitlist.status_updated: merchant_id and event_id required');
    }
    if (typeof pre_sale_count !== 'number' || pre_sale_cap == null) {
        error('[waitlistStatusUpdated] missing or invalid pre_sale_count/pre_sale_cap', { pre_sale_count, pre_sale_cap });
        return; // skip update but don't nack
    }

    const event = await Event.getEventByMerchantAndExternalId(merchantId, eventId);
    if (!event) {
        info('[waitlistStatusUpdated] event not found, skipping', { merchantId, eventId });
        return;
    }

    await Event.updateEventById(event._id, {
        pre_sale_waitlist_count: pre_sale_count,
        pre_sale_waitlist_cap: pre_sale_cap
    });
    info('[waitlistStatusUpdated] event updated', { eventId: event._id, pre_sale_count, pre_sale_cap });
};
