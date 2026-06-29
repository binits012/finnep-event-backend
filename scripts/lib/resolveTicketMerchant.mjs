/**
 * Resolve FEB + EMS merchant ids for accounting backfill / outbox repair.
 */
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Types;

export function ticketInfoObject(ticket) {
  if (!ticket?.ticketInfo) return {};
  return ticket.ticketInfo instanceof Map
    ? Object.fromEntries(ticket.ticketInfo)
    : ticket.ticketInfo;
}

export async function resolveTicketMerchant(db, ticket) {
  const info = ticketInfoObject(ticket);
  let febMerchantId = ticket?.merchant || info.merchantId || info.merchant || null;
  let emsMerchantId = ticket?.externalMerchantId || info.externalMerchantId || null;

  const eventId = ticket?.event || info.eventId || info.event;
  let event = null;
  if (eventId) {
    const filter = ObjectId.isValid(String(eventId))
      ? { _id: new ObjectId(String(eventId)) }
      : { _id: eventId };
    event = await db.collection('events').findOne(filter);
    if (event) {
      febMerchantId = febMerchantId || event.merchant || event.merchantId || null;
      emsMerchantId = emsMerchantId || event.externalMerchantId || event.merchantId || null;
    }
  }

  if (!febMerchantId && !emsMerchantId) {
    return { event, merchant: null, febMerchantId: null, emsMerchantId: null };
  }

  let merchant = null;
  const merchantFilters = [];
  if (febMerchantId && ObjectId.isValid(String(febMerchantId))) {
    merchantFilters.push({ _id: new ObjectId(String(febMerchantId)) });
  }
  if (emsMerchantId) {
    merchantFilters.push({ merchantId: String(emsMerchantId) });
  }
  if (merchantFilters.length > 0) {
    merchant = await db.collection('merchants').findOne({ $or: merchantFilters });
  }

  return {
    event,
    febMerchantId: febMerchantId ? String(febMerchantId) : null,
    emsMerchantId: emsMerchantId ? String(emsMerchantId) : null,
    merchant: merchant || {
      _id: febMerchantId,
      merchantId: emsMerchantId,
    },
  };
}
