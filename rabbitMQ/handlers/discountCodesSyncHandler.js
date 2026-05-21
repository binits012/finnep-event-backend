import * as Event from '../../model/event.js';
import { error, info } from '../../model/logger.js';

function mergeDiscountCodes(existingCodes, incomingCodes, resetUses = false) {
  const existingById = new Map(
    (Array.isArray(existingCodes) ? existingCodes : []).map((c) => [String(c.id), c])
  );

  return (Array.isArray(incomingCodes) ? incomingCodes : []).map((incoming) => {
    const id = String(incoming.id);
    const existing = existingById.get(id);
    let usesLeft = Number(incoming.uses_left ?? incoming.usesLeft ?? 0);

    if (existing && !resetUses) {
      const existingUses = Number(existing.uses_left ?? existing.usesLeft ?? usesLeft);
      // Never raise uses_left from sync after local redemptions (conservative merge).
      usesLeft = Math.min(usesLeft, existingUses);
    }

    return {
      id,
      code: String(incoming.code || '').trim().toUpperCase(),
      name: incoming.name || '',
      discount_type: incoming.discount_type === 'percentage' ? 'percentage' : 'fixed',
      discount_value: Number(incoming.discount_value ?? 0),
      max_uses: Number(incoming.max_uses ?? incoming.maxUses ?? 0),
      uses_left: usesLeft,
      active: incoming.active !== false,
      source: incoming.source || 'manual'
    };
  });
}

/**
 * Handle event.discount_codes.updated from event-merchant-service (RabbitMQ).
 */
export const handleDiscountCodesUpdated = async (message) => {
  const data = message?.data ?? message;
  const merchantId = data?.merchant_id ?? data?.merchantId;
  const eventId = data?.event_id != null
    ? String(data.event_id)
    : (data?.id != null ? String(data.id) : null);
  const incomingCodes = data?.discount_codes ?? data?.discountCodes ?? [];
  const resetUses = data?.reset_uses === true;

  if (merchantId == null || eventId == null) {
    error('[discountCodesUpdated] missing merchant_id or event_id', { merchantId, eventId });
    throw new Error('event.discount_codes.updated: merchant_id and event_id required');
  }

  const event = await Event.getEventByMerchantAndExternalId(merchantId, eventId);
  if (!event) {
    info('[discountCodesUpdated] event not found, skipping', { merchantId, eventId });
    return;
  }

  const doc = event._doc ?? event;
  const merged = mergeDiscountCodes(doc.discountCodes, incomingCodes, resetUses);

  await Event.updateEventById(event._id, { discountCodes: merged });
  info('[discountCodesUpdated] event updated', { eventId: event._id, codeCount: merged.length });
};
