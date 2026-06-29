/**
 * Resolve FEB + EMS merchant ids for accounting backfill / outbox repair.
 */
import mongoose from 'mongoose';
import { getPackSizeFromTicketType } from '../../util/ticketQuantity.js';

const { ObjectId } = mongoose.Types;

export function ticketInfoObject(ticket) {
  if (!ticket?.ticketInfo) return {};
  return ticket.ticketInfo instanceof Map
    ? Object.fromEntries(ticket.ticketInfo)
    : ticket.ticketInfo;
}

const normalizeName = (value) =>
  value == null ? '' : String(value).trim().toLowerCase();

/**
 * Find the event ticket-type config for a (possibly legacy) ticket.
 * Match by ticketInfo.ticketId → ticketInfo[]._id, else by name.
 */
function findTicketTypeConfigForTicket(event, ticket) {
  const types = Array.isArray(event?.ticketInfo) ? event.ticketInfo : [];
  if (types.length === 0) return null;

  const info = ticketInfoObject(ticket);
  const ticketId = info.ticketId != null ? String(info.ticketId) : null;
  if (ticketId) {
    const byId = types.find((t) => String(t?._id ?? t?.id ?? '') === ticketId);
    if (byId) return byId;
  }

  const candidateNames = [ticket?.type, info.ticketName, info.name]
    .map(normalizeName)
    .filter((n) => n.length > 0);
  if (candidateNames.length > 0) {
    const byName = types.find((t) => candidateNames.includes(normalizeName(t?.name)));
    if (byName) return byName;
  }

  return null;
}

/**
 * Pack size for a legacy ticket, derived from the event ticket-type config using
 * the SAME heuristic as checkout (getPackSizeFromTicketType). Returns 1 when unknown.
 */
export function resolveTicketPackSize(event, ticket) {
  const config = findTicketTypeConfigForTicket(event, ticket);
  return getPackSizeFromTicketType(config);
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
